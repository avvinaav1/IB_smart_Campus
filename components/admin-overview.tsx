"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, BellRing, CalendarDays, CheckCircle2, Clock, FileText, LoaderCircle, RefreshCw, Square, Users } from "lucide-react";
import type { AppRole } from "@/lib/types";

type AdminUser = { id: string; username: string; email: string; campus: string; createdAt: number; appRole: AppRole; protected: boolean };
type DailyPoint = { day: string; signups: number; active: number };
type AdminStats = {
  generatedAt: number;
  users: {
    total: number; profileComplete: number; withPassword: number; moderators: number; signedIn: number;
    newUsers: { today: number; last7Days: number; last30Days: number };
    activeUsers: { last24Hours: number; last7Days: number; last30Days: number };
    daily: DailyPoint[]; recentUsers: AdminUser[]; topCampuses: Array<{ campus: string; users: number }>;
  };
  communities: { total: number; pending: number; newSince: number; memberships: number };
  events: { total: number; pending: number; approved: number; rejected: number; upcoming: number; newSince: number; registrations: number; checkedIn: number };
  posts: { total: number; newSince: number; comments: number };
  certificates: null | {
    claims: { total: number; claimed: number; pending: number; newSince: number };
    certificates: { active: number; internal: number; external: number; public: number; newSince: number };
    jobs: { total: number; withErrors: number };
  };
};
type AdminClaim = {
  id: string; email: string; title: string; issuerName: string; eventId: string | null; verificationCode: string | null;
  claimed: boolean; createdAt: number; claimedAt: number | null; claimedBy: { id: string; username: string } | null;
};

type ReminderOverview = {
  configured: boolean; from: string | null; batchSize: number; dailyLimit: number; minAgeHours: number;
  campaign: null | {
    status: "running" | "completed" | "cancelled" | "failed"; startedAt: number; totalAtStart: number;
    scanned: number; sent: number; skipped: number; failed: number; sentToday: number; dailyLimit: number;
    limitReached: boolean; resumesAt: number; finishedAt: number | null; error: string | null;
  };
};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "The admin request failed.");
  return result.data as T;
}

const number = new Intl.NumberFormat();
const when = (value: number) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
const percent = (part: number, total: number) => total ? `${Math.round((part / total) * 100)}%` : "—";

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return <div className="admin-stat"><span>{label}</span><b>{number.format(value)}</b>{hint && <small>{hint}</small>}</div>;
}

function DailyBars({ title, points, field }: { title: string; points: DailyPoint[]; field: "signups" | "active" }) {
  const max = Math.max(1, ...points.map((point) => point[field]));
  const total = points.reduce((sum, point) => sum + point[field], 0);
  const label = (point: DailyPoint) => `${new Date(`${point.day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })}: ${number.format(point[field])}`;
  return <figure className="admin-chart">
    <figcaption><b>{title}</b><small>{number.format(total)} in the last 30 days · peak {number.format(max)}/day</small></figcaption>
    <div className="admin-bars" role="img" aria-label={`${title}, last 30 days`}>
      {points.map((point) => <span key={point.day} className="admin-bar" data-tip={label(point)} aria-label={label(point)}>
        <i style={{ height: point[field] ? `${Math.max(4, (point[field] / max) * 100)}%` : 0 }} />
      </span>)}
    </div>
    <div className="admin-chart-axis"><small>{points[0]?.day.slice(5)}</small><small>Today (UTC)</small></div>
  </figure>;
}

export function AdminOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setStats(await get<AdminStats>("/api/admin/stats")); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load stats."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  if (!stats) return busy ? <div className="moderation-loading"><LoaderCircle className="spin" /> Loading stats…</div> : <p className="form-error" role="alert">{error}</p>;
  const { users, communities, events, posts, certificates } = stats;
  return <div className="admin-overview">
    <div className="admin-overview-bar"><small>Updated {when(stats.generatedAt)}</small><button onClick={() => void load()} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} /> Refresh</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}

    <section className="admin-section"><h2><Users size={17} /> Users</h2>
      <div className="admin-stat-grid">
        <Stat label="Total users" value={users.total} hint={`${percent(users.profileComplete, users.total)} finished profile setup`} />
        <Stat label="New today" value={users.newUsers.today} />
        <Stat label="New · 7 days" value={users.newUsers.last7Days} />
        <Stat label="New · 30 days" value={users.newUsers.last30Days} />
        <Stat label="Active · 24 hours" value={users.activeUsers.last24Hours} hint={percent(users.activeUsers.last24Hours, users.total) + " of users"} />
        <Stat label="Active · 7 days" value={users.activeUsers.last7Days} hint={percent(users.activeUsers.last7Days, users.total) + " of users"} />
        <Stat label="Active · 30 days" value={users.activeUsers.last30Days} hint={percent(users.activeUsers.last30Days, users.total) + " of users"} />
        <Stat label="Signed in now" value={users.signedIn} hint="Users with a live session" />
      </div>
      <div className="admin-chart-grid">
        <DailyBars title="New registrations per day" points={users.daily} field="signups" />
        <DailyBars title="Users by last active day" points={users.daily} field="active" />
      </div>
      <div className="admin-two-col">
        <div className="admin-card"><h3>Newest registrations</h3>{users.recentUsers.length ? users.recentUsers.map((user) => <p key={user.id}><b>{user.username}</b><small>{user.email} · {user.campus || "No campus"} · {when(user.createdAt)}</small></p>) : <small>No users yet.</small>}</div>
        <div className="admin-card"><h3>Top campuses</h3>{users.topCampuses.length ? users.topCampuses.map((row) => <p key={row.campus} className="admin-row"><span>{row.campus}</span><b>{number.format(row.users)}</b></p>) : <small>No campuses set yet.</small>}
          <h3>Accounts</h3><p className="admin-row"><span>Password set</span><b>{number.format(users.withPassword)}</b></p><p className="admin-row"><span>Moderators &amp; admins</span><b>{number.format(users.moderators)}</b></p></div>
      </div>
    </section>

    <section className="admin-section"><h2><Award size={17} /> Certificates</h2>
      {certificates ? <div className="admin-stat-grid">
        <Stat label="Claims recorded" value={certificates.claims.total} hint={`${number.format(certificates.claims.newSince)} in the last 7 days`} />
        <Stat label="Claimed" value={certificates.claims.claimed} hint={`${percent(certificates.claims.claimed, certificates.claims.total)} claim rate`} />
        <Stat label="Awaiting claim" value={certificates.claims.pending} hint="Emailed, no account yet" />
        <Stat label="Active certificates" value={certificates.certificates.active} hint={`${number.format(certificates.certificates.newSince)} issued in 7 days`} />
        <Stat label="Issued in-app" value={certificates.certificates.internal} />
        <Stat label="Uploaded by users" value={certificates.certificates.external} />
        <Stat label="Public on profiles" value={certificates.certificates.public} />
        <Stat label="Batch jobs" value={certificates.jobs.total} hint={`${number.format(certificates.jobs.withErrors)} with errors`} />
      </div> : <p className="moderation-muted">Certificate stats are unavailable right now.</p>}
    </section>

    <section className="admin-section"><h2><CalendarDays size={17} /> Content</h2>
      <div className="admin-stat-grid">
        <Stat label="Events" value={events.total} hint={`${number.format(events.newSince)} created in 7 days`} />
        <Stat label="Upcoming events" value={events.upcoming} />
        <Stat label="Events pending review" value={events.pending} hint={`${number.format(events.approved)} approved · ${number.format(events.rejected)} rejected`} />
        <Stat label="Registrations" value={events.registrations} hint={`${number.format(events.checkedIn)} checked in`} />
        <Stat label="Communities" value={communities.total} hint={`${number.format(communities.pending)} pending · ${number.format(communities.newSince)} new in 7 days`} />
        <Stat label="Memberships" value={communities.memberships} />
        <Stat label="Posts" value={posts.total} hint={`${number.format(posts.newSince)} in 7 days`} />
        <Stat label="Comments" value={posts.comments} />
      </div>
    </section>
  </div>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "The admin request failed.");
  return result.data as T;
}

// One click starts a run; while it's active this panel keeps asking the server
// to process the next batch. Each batch is capped (and so is each day), so the
// run stays well inside Firestore's daily read quota. The cron route continues
// it when nobody has the dashboard open.
function ReminderPanel() {
  const [overview, setOverview] = useState<ReminderOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const campaign = overview?.campaign;
  const active = campaign?.status === "running" && !campaign.limitReached;

  const call = useCallback(async (action?: "start" | "tick" | "cancel") => {
    setBusy(true); setError("");
    try { setOverview(action ? await post<ReminderOverview>("/api/admin/certificate-reminders", { action }) : await get<ReminderOverview>("/api/admin/certificate-reminders")); }
    catch (callError) { setError(callError instanceof Error ? callError.message : "Reminder request failed."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void call(), 0); return () => window.clearTimeout(timer); }, [call]);
  useEffect(() => {
    if (!active || busy) return;
    const timer = window.setTimeout(() => void call("tick"), error ? 15000 : 3000);
    return () => window.clearTimeout(timer);
  }, [active, busy, error, call, overview]);

  if (!overview) return null;
  const processed = campaign ? campaign.scanned : 0;
  const progress = campaign?.totalAtStart ? Math.min(100, Math.round((processed / campaign.totalAtStart) * 100)) : 100;
  return <div className="admin-card admin-reminders">
    <h3><BellRing size={15} /> Unclaimed certificate reminders</h3>
    {!overview.configured ? <small>Configure <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>AUTH_FROM_EMAIL</code> to enable reminders.</small> : <>
      <small>Emails every address with a certificate emailed over {overview.minAgeHours}h ago and still unclaimed — once per address per run, from {overview.from}. Runs in batches of {overview.batchSize}, at most {number.format(overview.dailyLimit)} emails/day, and continues automatically.</small>
      {campaign && <>
        <div className="admin-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div>
        <p className="admin-row"><span>{campaign.status === "running" ? (campaign.limitReached ? `Daily limit reached — resumes after ${when(campaign.resumesAt)}` : "Sending…") : campaign.status === "completed" ? `Finished${campaign.finishedAt ? ` ${when(campaign.finishedAt)}` : ""}` : campaign.status === "cancelled" ? "Stopped" : "Failed"}</span><b>{number.format(processed)} / {number.format(campaign.totalAtStart)}</b></p>
        <small>{number.format(campaign.sent)} emails sent · {number.format(campaign.skipped)} duplicate addresses skipped · {number.format(campaign.failed)} failed · {number.format(campaign.sentToday)}/{number.format(campaign.dailyLimit)} today · started {when(campaign.startedAt)}</small>
        {campaign.error && <p className="form-error" role="alert">{campaign.error}</p>}
      </>}
      <div className="admin-reminder-actions">
        {campaign?.status === "running"
          ? <button onClick={() => void call("cancel")} disabled={busy}><Square size={13} /> Stop run</button>
          : confirming
            ? <><button className="approve-action" onClick={() => { setConfirming(false); void call("start"); }} disabled={busy}>Yes, send reminders</button><button onClick={() => setConfirming(false)}>Cancel</button></>
            : <button className="approve-action" onClick={() => setConfirming(true)} disabled={busy}><BellRing size={13} /> Remind everyone who hasn&apos;t claimed</button>}
        {busy && <LoaderCircle size={15} className="spin" />}
      </div>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function CertificateClaimsPanel() {
  const [status, setStatus] = useState<"all" | "claimed" | "pending">("all");
  const [items, setItems] = useState<AdminClaim[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (next?: string | null) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ status, limit: "25" });
      if (next) params.set("cursor", next);
      const page = await get<{ items: AdminClaim[]; nextCursor: string | null }>(`/api/admin/certificate-claims?${params}`);
      setItems((current) => next ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load claims."); }
    finally { setBusy(false); }
  }, [status]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  return <>
    <ReminderPanel />
    <nav className="moderation-tabs admin-subtabs" aria-label="Claim status">{(["all", "claimed", "pending"] as const).map((value) => <button key={value} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setItems([]); setCursor(null); }}>{value}</button>)}</nav>
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && !items.length ? <div className="moderation-loading"><LoaderCircle className="spin" /> Loading…</div> : <div className="moderation-list">
      {items.map((claim) => <article key={claim.id}>
        <div><b>{claim.title}</b><small>{claim.email} · from {claim.issuerName} · emailed {when(claim.createdAt)}{claim.verificationCode ? ` · ${claim.verificationCode}` : ""}</small>
          {claim.claimed && <small>Claimed by {claim.claimedBy?.username || "unknown"}{claim.claimedAt ? ` on ${when(claim.claimedAt)}` : ""}</small>}</div>
        <span className={`moderation-badge ${claim.claimed ? "approved" : "pending"}`}>{claim.claimed ? <><CheckCircle2 size={10} /> CLAIMED</> : <><Clock size={10} /> PENDING</>}</span>
      </article>)}
      {!items.length && !busy && !error && <div className="moderation-empty"><FileText /><b>No claims</b><span>No certificate claims match this filter.</span></div>}
    </div>}
    {cursor && <button className="load-more" disabled={busy} onClick={() => void load(cursor)}>{busy ? "Loading…" : "Load more"}</button>}
  </>;
}
