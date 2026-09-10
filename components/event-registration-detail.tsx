"use client";

import Image from "next/image";
import { Check, Download, ExternalLink, KeyRound, LoaderCircle, MapPin, Pencil, ScanLine, Search, ShieldCheck, TicketCheck, UserPlus, Users, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { coverImageStyle, eventWhen } from "@/lib/event-format";
import type { CampusEvent, CustomFormAnswers, CustomFormField, EventAdmin, EventAttendee, UserSearchResult } from "@/lib/types";

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result.data;
}

function MiniAvatar({ name, image }: { name: string; image?: string }) {
  return <span className="event-admin-avatar">{image ? <Image src={image} alt="" fill sizes="34px" unoptimized /> : name.slice(0, 2).toUpperCase()}</span>;
}

function RegistrationQuestion({ field, value, onChange }: { field: CustomFormField; value: string | number | boolean | undefined; onChange: (value: string | number | boolean | undefined) => void }) {
  if (field.type === "checkbox") return <label className="registration-checkbox"><input type="checkbox" checked={value === true} onChange={event => onChange(event.target.checked)} required={field.required} /><span><b>{field.label}</b>{field.required && <small>Required</small>}</span></label>;
  if (field.type === "long_text") return <label className="field"><span>{field.label}{field.required && <em>Required</em>}</span><textarea value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} maxLength={field.maxLength || 5000} rows={4} required={field.required} /></label>;
  if (field.type === "select") return <label className="field"><span>{field.label}{field.required && <em>Required</em>}</span><select value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value || undefined)} required={field.required}><option value="">Choose an option</option>{field.options.map(option => <option value={option.value} key={option.id}>{option.label}</option>)}</select></label>;
  if (field.type === "number") return <label className="field"><span>{field.label}{field.required && <em>Required</em>}</span><input type="number" value={typeof value === "number" ? value : ""} min={field.min} max={field.max} onChange={event => onChange(event.target.value === "" ? undefined : Number(event.target.value))} required={field.required} /></label>;
  return <label className="field"><span>{field.label}{field.required && <em>Required</em>}</span><input value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} placeholder={field.placeholder} maxLength={field.maxLength || 500} required={field.required} /></label>;
}

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function qrScanSupported() {
  return typeof window !== "undefined"
    && "BarcodeDetector" in window
    && typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

// Client-only capability check, without a hydration mismatch or setState-in-effect.
const noopSubscribe = () => () => {};
function useQrScanSupported() {
  return useSyncExternalStore(noopSubscribe, qrScanSupported, () => false);
}

function QrScanner({ onCode, onClose, onError }: { onCode: (code: string) => void; onClose: () => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) { onErrorRef.current("This browser can’t scan QR codes — type the code instead."); onCloseRef.current(); return; }
    const detector = new Detector({ formats: ["qr_code"] });

    async function scanLoop() {
      if (stopped || !videoRef.current) return;
      try {
        const found = (await detector.detect(videoRef.current))
          .map((code) => code.rawValue.toUpperCase().replace(/[^A-Z0-9]/g, ""))
          .find((value) => value.length >= 6);
        if (found) { onCodeRef.current(found.slice(0, 6)); return; }
      } catch { /* a frame that can't be decoded — keep going */ }
      frame = requestAnimationFrame(scanLoop);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(scanLoop);
      } catch (error) {
        onErrorRef.current(error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera access was blocked — allow it or type the code."
          : "Could not open the camera — type the code instead.");
        onCloseRef.current();
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return <div className="qr-scanner">
    <video ref={videoRef} muted playsInline aria-label="QR scanner camera preview" />
    <div className="qr-scanner-frame" aria-hidden="true" />
    <button type="button" className="qr-scanner-stop" onClick={onClose}><X size={14} /> Stop scanning</button>
  </div>;
}

function EventAdminDashboard({ event, notify }: { event: CampusEvent; notify: (message: string) => void }) {
  const [attendees, setAttendees] = useState<EventAttendee[] | null>(null);
  const [admins, setAdmins] = useState<EventAdmin[]>([]);
  const [checkInCode, setCheckInCode] = useState("");
  const [checkingIn, setCheckingIn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [adminBusy, setAdminBusy] = useState("");
  const canScan = useQrScanSupported();

  useEffect(() => {
    let active = true;
    Promise.all([
        requestJson<{ attendees: EventAttendee[] }>(`/api/events/${event.id}/rsvps`, { cache: "no-store" }),
        requestJson<{ admins: EventAdmin[] }>(`/api/events/${event.id}/admins`, { cache: "no-store" }),
      ]).then(([attendeeData, adminData]) => {
      if (!active) return;
      setAttendees(attendeeData?.attendees || []);
      setAdmins(adminData?.admins || []);
    }).catch((error: unknown) => {
      if (!active) return;
      setAttendees([]);
      notify(error instanceof Error ? error.message : "Could not load the event dashboard.");
    });
    return () => { active = false; };
  }, [event.id, notify]);

  useEffect(() => {
    if (!event.isCreator || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await requestJson<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal });
        const assigned = new Set(admins.map(admin => admin.userId));
        setResults((data?.users || []).filter(user => !assigned.has(user.id)));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      }
    }, 320);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [admins, event.isCreator, query]);

  async function submitCode(rawCode: string) {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (checkingIn || code.length !== 6) return;
    setCheckingIn(true);
    try {
      const data = await requestJson<{ attendee: EventAttendee }>(`/api/events/${event.id}/check-in`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      if (!data?.attendee) throw new Error("The server did not return the checked-in attendee.");
      setAttendees(current => (current || []).map(attendee => attendee.rsvpId === data.attendee.rsvpId ? data.attendee : attendee));
      setCheckInCode("");
      setScanning(false);
      notify(`${data.attendee.username} checked in`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not check in this attendee.");
    } finally { setCheckingIn(false); }
  }

  function checkIn(submission: React.FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    void submitCode(checkInCode);
  }

  async function addAdmin(user: UserSearchResult) {
    setAdminBusy(user.id);
    try {
      const data = await requestJson<{ admin: EventAdmin }>(`/api/events/${event.id}/admins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id }) });
      if (!data?.admin) throw new Error("The server did not return the new administrator.");
      setAdmins(current => [...current, data.admin]);
      setQuery(""); setResults([]);
      notify(`${user.username} can now manage this event`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not add this administrator."); }
    finally { setAdminBusy(""); }
  }

  async function removeAdmin(admin: EventAdmin) {
    setAdminBusy(admin.userId);
    try {
      await requestJson(`/api/events/${event.id}/admins/${admin.userId}`, { method: "DELETE" });
      setAdmins(current => current.filter(item => item.userId !== admin.userId));
      notify(`${admin.username} removed from event admins`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not remove this administrator."); }
    finally { setAdminBusy(""); }
  }

  const checkedIn = attendees?.filter(attendee => attendee.status === "CHECKED_IN").length || 0;
  const visibleResults = query.trim().length >= 2 ? results : [];
  return <section className="event-admin-dashboard">
    <header><div><span className="eyebrow cyan">EVENT ADMIN DASHBOARD</span><h3>Run the door</h3><p>{checkedIn} of {attendees?.filter(attendee => attendee.rsvpStatus === "going").length ?? 0} confirmed attendees checked in.</p></div><a href={`/api/events/${event.id}/rsvps/export`} download><Download size={16} /> Export CSV</a></header>
    <form className="check-in-form" onSubmit={checkIn}>
      <label htmlFor={`check-in-${event.id}`}><KeyRound size={19} /><span><b>Check-in code</b><small>Scan the attendee&apos;s QR, or type their six-character code.</small></span></label>
      <div>
        <input id={`check-in-${event.id}`} value={checkInCode} onChange={input => setCheckInCode(input.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="A7K9PQ" minLength={6} maxLength={6} autoComplete="off" required />
        {canScan && <button type="button" className="scan-toggle" onClick={() => setScanning(value => !value)}><ScanLine size={16} /> {scanning ? "Close" : "Scan QR"}</button>}
        <button disabled={checkingIn || checkInCode.length !== 6}>{checkingIn ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Check in</button>
      </div>
      {scanning && <QrScanner onCode={(code) => void submitCode(code)} onClose={() => setScanning(false)} onError={notify} />}
    </form>
    <section className="dashboard-attendees"><header><b>Attendees</b><span>{attendees?.length ?? "…"}</span></header>{attendees === null ? <div className="attendee-loading"><LoaderCircle className="spin" size={20} /> Loading registrations…</div> : attendees.length ? <div className="attendee-list">{attendees.map(attendee => <div key={attendee.rsvpId}><MiniAvatar name={attendee.username} /><span><b>{attendee.username}</b><small>{attendee.email} · <code>{attendee.checkInCode}</code></small></span><em className={attendee.status === "CHECKED_IN" ? "checked" : ""}>{attendee.rsvpStatus === "waitlisted" ? "Waitlisted" : attendee.status === "CHECKED_IN" ? "Checked in" : "Registered"}</em></div>)}</div> : <p className="attendee-empty">No registrations yet.</p>}</section>
    {event.isCreator && <section className="event-admins-manager"><header><div><b>Co-admins</b><small>Add trusted people to export attendees and check people in.</small></div><span>{admins.length}</span></header>{admins.length > 0 && <div className="event-admin-list">{admins.map(admin => <div key={admin.id}><MiniAvatar name={admin.username} image={admin.avatarUrl} /><b>{admin.username}</b><button type="button" disabled={adminBusy === admin.userId} onClick={() => void removeAdmin(admin)} aria-label={`Remove ${admin.username}`}><X size={15} /></button></div>)}</div>}<label className="admin-search"><Search size={17} /><input value={query} onChange={input => setQuery(input.target.value)} placeholder="Search by username" maxLength={50} /></label>{visibleResults.length > 0 && <div className="admin-search-results">{visibleResults.map(user => <button type="button" disabled={Boolean(adminBusy)} onClick={() => void addAdmin(user)} key={user.id}><MiniAvatar name={user.username} image={user.avatarUrl} /><span><b>{user.username}</b><small>{user.about || "Smart Campus member"}</small></span>{adminBusy === user.id ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}</button>)}</div>}</section>}
  </section>;
}

export function EventRegistrationDetail({ event, close, notify, onChange, onEdit }: { event: CampusEvent; close: () => void; notify: (message: string) => void; onChange: (event: CampusEvent) => void; onEdit?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [answers, setAnswers] = useState<CustomFormAnswers>({});
  const nearlyFull = event.going >= event.capacity;

  async function submitRegistration(submission?: React.FormEvent<HTMLFormElement>) {
    submission?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const data = await requestJson<{ event: CampusEvent }>(`/api/events/${event.id}/rsvp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
      if (!data?.event) throw new Error("The server did not return your registration.");
      onChange(data.event); setRegistrationOpen(false);
      notify(data.event.viewerRsvpStatus === "waitlisted" ? "You joined the waitlist" : "Registration confirmed — your ticket is ready");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not complete your registration."); }
    finally { setBusy(false); }
  }

  async function cancelRsvp() {
    if (busy || event.viewerCheckInStatus === "CHECKED_IN") return;
    setBusy(true);
    try {
      const data = await requestJson<{ event: CampusEvent }>(`/api/events/${event.id}/rsvp`, { method: "DELETE" });
      if (!data?.event) throw new Error("The server did not return your updated RSVP.");
      onChange(data.event); setAnswers({}); notify("RSVP cancelled");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not cancel your RSVP."); }
    finally { setBusy(false); }
  }

  function beginRegistration() {
    if (event.customFormSchema.fields.length) setRegistrationOpen(true);
    else void submitRegistration();
  }

  return <div className="overlay" onMouseDown={mouse => mouse.target === mouse.currentTarget && close()}><section className={`event-modal ${adminOpen ? "admin-mode" : ""}`} role="dialog" aria-modal="true" aria-label={event.title}><div className={`event-modal-image ${event.coverFit === "fit" ? "cover-fit" : ""}`}><Image src={event.imageUrl} alt="" fill sizes="760px" unoptimized={event.imageUrl.startsWith("/api/")} style={coverImageStyle(event)} /><button className="icon-button" type="button" onClick={close} aria-label="Close"><X size={20} /></button><span>{event.isCreator ? "YOUR EVENT" : event.isEventAdmin ? "YOU’RE AN ADMIN" : event.category}</span>{event.isCreator && onEdit && <button className="event-edit-button" type="button" onClick={onEdit}><Pencil size={14} /> Edit event</button>}</div><div className="event-modal-copy"><span className="eyebrow pink">{eventWhen(event)}</span><h2>{event.title}</h2><p className="event-location"><MapPin size={18} /><span><b>{event.venueName}</b><small>{event.venueAddress} · {event.campus}</small></span>{event.directionsUrl && <a href={event.directionsUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Directions</a>}</p><p>{event.description || "The details are set. Bring your campus energy and show up for the people making it happen."}</p><div className="capacity-row"><div><Users size={19} /><span><b>{event.going} going</b><small>{Math.max(0, event.capacity - event.going)} spots left{event.waitlisted ? ` · ${event.waitlisted} waitlisted` : ""}</small></span></div><div className="progress"><i style={{ width: `${Math.min(100, event.going / event.capacity * 100)}%` }} /></div></div>
    {event.viewerRsvpStatus && event.viewerCheckInCode && <section className={`event-ticket ${event.viewerCheckInStatus === "CHECKED_IN" ? "used" : ""}`}><div><span>{event.viewerRsvpStatus === "waitlisted" ? "WAITLIST TICKET" : "ADMIT ONE"}</span><b>{event.title}</b><small>{eventWhen(event)}</small></div><strong>{event.viewerCheckInCode}</strong><em>{event.viewerCheckInStatus === "CHECKED_IN" ? "CHECKED IN" : "SHOW AT ENTRY"}</em><figure className="event-ticket-qr">
      {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered SVG from our API, not a static asset for next/image */}
      <img src={`/api/events/${event.id}/ticket-qr`} width={128} height={128} alt={`Attendance QR code for ${event.viewerCheckInCode}`} />
      <figcaption>{event.viewerCheckInStatus === "CHECKED_IN" ? "Already scanned" : "Scan to check in"}</figcaption>
    </figure></section>}
    {registrationOpen && !event.viewerRsvpStatus && <form className="registration-form" onSubmit={submitRegistration}><header><div><span className="eyebrow violet">REGISTRATION</span><h3>A few details before you&apos;re in</h3></div><button type="button" onClick={() => setRegistrationOpen(false)} aria-label="Close registration form"><X size={16} /></button></header>{event.customFormSchema.fields.map(field => <RegistrationQuestion field={field} value={answers[field.id]} onChange={value => setAnswers(current => { const next = { ...current }; if (value === undefined || value === "") delete next[field.id]; else next[field.id] = value; return next; })} key={field.id} />)}<button className="registration-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <TicketCheck size={18} />} {nearlyFull ? "Join waitlist" : "Confirm registration"}</button></form>}
    <div className="disclosure"><ShieldCheck size={19} /><p>Your verified email and registration answers are shared only with this event&apos;s creator and assigned event admins.</p></div>
    {event.canManageEvent && <div className="creator-event-actions"><button type="button" onClick={() => setAdminOpen(current => !current)}><Users size={17} /> {adminOpen ? "Close dashboard" : "Admin dashboard"}</button><a href={`/api/events/${event.id}/rsvps/export`} download><Download size={17} /> Export CSV</a></div>}
    {adminOpen && event.canManageEvent && <EventAdminDashboard event={event} notify={notify} />}
    {!registrationOpen && <button className={event.viewerRsvpStatus ? "rsvp-button going" : "rsvp-button"} disabled={busy || event.viewerCheckInStatus === "CHECKED_IN"} onClick={() => event.viewerRsvpStatus ? void cancelRsvp() : beginRegistration()}>{busy ? <><LoaderCircle className="spin" size={20} /> Updating…</> : event.viewerCheckInStatus === "CHECKED_IN" ? <><Check size={20} /> Checked in</> : event.viewerRsvpStatus ? <><Check size={20} /> {event.viewerRsvpStatus === "waitlisted" ? "Leave waitlist" : "Cancel RSVP"}</> : <><TicketCheck size={20} /> {nearlyFull ? "Join waitlist" : "RSVP now"}</>}</button>}
  </div></section></div>;
}
