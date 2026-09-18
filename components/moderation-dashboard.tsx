"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Plus, Search, ShieldCheck, Trash2, UserCog, X } from "lucide-react";
import type { AppRole, CampusEvent, Community, CommunityRole, EventAttendee, EventStatus, Institute, InstituteRole, InstituteSummary, Post, SessionUser, UserSearchResult } from "@/lib/types";

type Page<T> = { items: T[]; nextCursor: string | null };
type AdminUser = { id: string; username: string; email: string; campus: string; createdAt: number; appRole: AppRole; protected: boolean };
type AdminCommunity = { id: string; name: string; description: string; creatorId: string; privacy: string; type: string; parentId: string | null; members: number; createdAt: number };
type CommunityMember = { id: string; userId: string; username: string; avatarUrl: string; role: CommunityRole; createdAt: number; inherited: boolean; readOnly: boolean; inheritedFromCommunityName: string | null };
type InstituteMemberView = { userId: string; username: string; avatarUrl: string; role: InstituteRole };
type InstituteWorkspace = {
  institute: Institute;
  role: InstituteRole | null;
  canApprove: boolean;
  canApproveEvents: boolean;
  members: InstituteMemberView[];
  communities: Community[];
  pendingCommunities: Community[];
  pendingEvents: CampusEvent[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "The moderation request failed.");
  return result.data as T;
}

function date(value: number) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function eventWhenLabel(event: CampusEvent) {
  return new Date(event.startsAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`moderation-badge ${value.toLowerCase()}`}>{value.replaceAll("_", " ")}</span>;
}

export function GlobalAdminDashboard({ user, notify }: { user: SessionUser; notify: (message: string) => void }) {
  const [tab, setTab] = useState<"users" | "communities" | "events" | "posts">("users");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [items, setItems] = useState<Array<AdminUser | AdminCommunity | CampusEvent | Post>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<{ event: CampusEvent; attendees: Array<EventAttendee & { username: string; email: string }> } | null>(null);

  const load = useCallback(async (append = false, next?: string | null) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ query, limit: "25" });
      if (tab === "events" && status) params.set("status", status);
      if (next) params.set("cursor", next);
      const page = await api<Page<AdminUser | AdminCommunity | CampusEvent | Post>>(`/api/admin/${tab}?${params}`);
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load moderation data."); }
    finally { setBusy(false); }
  }, [query, status, tab]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  async function remove(url: string, id: string, label: string) {
    if (!window.confirm(`Delete ${label}? This permanently removes its dependent data.`)) return;
    setAction(id);
    try {
      const result = await api<{ deleted?: { communityIds?: string[] } }>(url, { method: "DELETE" });
      const deletedIds = new Set(result?.deleted?.communityIds || [id]);
      setItems((current) => current.filter((item) => !deletedIds.has(String(item.id))));
      notify(`${label} deleted`);
    }
    catch (removeError) { notify(removeError instanceof Error ? removeError.message : `Could not delete ${label}.`); }
    finally { setAction(""); }
  }

  async function role(target: AdminUser, appRole: "USER" | "APP_MODERATOR") {
    setAction(target.id);
    try {
      const result = await api<{ user: AdminUser }>(`/api/admin/users/${target.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appRole }) });
      setItems((current) => current.map((item) => item.id === target.id ? result.user : item)); notify("App role updated");
    } catch (roleError) { notify(roleError instanceof Error ? roleError.message : "Could not update the role."); }
    finally { setAction(""); }
  }

  async function removeComment(postId: number, commentId: string) {
    if (!window.confirm("Delete this comment permanently?")) return;
    setAction(commentId);
    try {
      await api(`/api/moderation/posts/${postId}/comments/${commentId}`, { method: "DELETE" });
      setItems((current) => current.map((item) => item.id === postId ? { ...item, commentItems: ((item as Post).commentItems || []).filter((comment) => comment.id !== commentId), comments: Math.max(0, (item as Post).comments - 1) } as Post : item));
      notify("Comment deleted");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not delete the comment."); }
    finally { setAction(""); }
  }

  async function review(event: CampusEvent, next: "APPROVED" | "REJECTED") {
    if (!event.community && !event.instituteId) return;
    setAction(event.id);
    try {
      const url = event.community
        ? `/api/communities/${encodeURIComponent(event.community)}/events/${event.id}/review`
        : `/api/institutes/${encodeURIComponent(event.instituteId || "")}/events`;
      const result = await api<{ event: CampusEvent }>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event.community ? { status: next } : { eventId: event.id, status: next }) });
      setItems((current) => current.map((item) => item.id === event.id ? result.event : item)); notify(`Event ${next.toLowerCase()}`);
    } catch (reviewError) { notify(reviewError instanceof Error ? reviewError.message : "Could not review the event."); }
    finally { setAction(""); }
  }

  async function openEvent(eventId: string) {
    setAction(eventId);
    try { setDetail(await api(`/api/admin/events/${eventId}`)); }
    catch (detailError) { notify(detailError instanceof Error ? detailError.message : "Could not load event details."); }
    finally { setAction(""); }
  }

  return <div className="content-page moderation-page">
    <section className="page-hero moderation-hero"><div><span className="eyebrow lime">GLOBAL CONTROL</span><h1>Admin dashboard.</h1><p>Review hidden events, manage roles, and remove unsafe content across Smart Campus.</p></div><ShieldCheck size={58} /></section>
    <nav className="moderation-tabs" aria-label="Admin resources">{(["users", "communities", "events", "posts"] as const).map((value) => <button key={value} className={tab === value ? "active" : ""} onClick={() => { setTab(value); setItems([]); setCursor(null); }}>{value}</button>)}</nav>
    <div className="moderation-toolbar"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}`} /></label>{tab === "events" && <label><select value={status} onChange={(event) => setStatus(event.target.value as EventStatus | "")}><option value="">All statuses</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select><ChevronDown size={15} /></label>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && !items.length ? <div className="moderation-loading"><LoaderCircle className="spin" /> Loading…</div> : <div className="moderation-list">
      {tab === "users" && (items as AdminUser[]).map((item) => <article key={item.id}><div><b>{item.username}</b><small>{item.email} · {item.campus || "No campus"} · Joined {date(item.createdAt)}</small></div><StatusBadge value={item.appRole} />{user.appRole === "SUPER_ADMIN" && !item.protected && <select aria-label={`Role for ${item.username}`} value={item.appRole} disabled={action === item.id} onChange={(event) => void role(item, event.target.value as "USER" | "APP_MODERATOR")}><option value="USER">User</option><option value="APP_MODERATOR">App moderator</option></select>}{!item.protected && <button className="danger-action" disabled={action === item.id} onClick={() => void remove(`/api/admin/users/${item.id}`, item.id, item.username)}><Trash2 size={15} /> Delete</button>}</article>)}
      {tab === "communities" && (items as AdminCommunity[]).map((item) => <article key={item.id}><div><b>{item.name}</b><small>{item.members} members · {item.type.toLowerCase()} · {item.parentId ? "sub-community" : "top-level"} · {item.privacy} · {item.description}</small></div><button className="danger-action" disabled={action === item.id} onClick={() => void remove(`/api/admin/communities/${encodeURIComponent(item.id)}`, item.id, item.name)}><Trash2 size={15} /> Delete</button></article>)}
      {tab === "events" && (items as CampusEvent[]).map((item) => <article key={item.id}><div><b>{item.title}</b><small>{item.campus} · {date(item.createdAt)}{item.community ? ` · ${item.community}` : item.instituteId ? " · institute event" : " · standalone"}</small></div><StatusBadge value={item.status} /><button onClick={() => void openEvent(item.id)}>Details</button>{item.status === "PENDING" && (item.community || item.instituteId) && <><button className="approve-action" disabled={action === item.id} onClick={() => void review(item, "APPROVED")}><Check size={15} /> Approve</button><button disabled={action === item.id} onClick={() => void review(item, "REJECTED")}><X size={15} /> Reject</button></>}<button className="danger-action" disabled={action === item.id} onClick={() => void remove(`/api/moderation/events/${item.id}`, item.id, item.title)}><Trash2 size={15} /> Delete</button></article>)}
      {tab === "posts" && (items as Post[]).map((item) => <article className="moderation-post" key={item.id}><div><b>{item.title}</b><small>{item.author} · {item.community} · {item.comments} comments</small>{item.commentItems?.map((comment) => <span className="moderation-comment" key={comment.id}>{comment.author}: {comment.body}<button disabled={action === comment.id} aria-label={`Delete comment by ${comment.author}`} onClick={() => void removeComment(item.id, comment.id)}><Trash2 size={13} /></button></span>)}</div><button className="danger-action" disabled={action === String(item.id)} onClick={() => void remove(`/api/moderation/posts/${item.id}`, String(item.id), item.title)}><Trash2 size={15} /> Delete</button></article>)}
      {!items.length && !busy && <div className="moderation-empty"><ShieldCheck /><b>Nothing to review</b><span>No {tab} match these filters.</span></div>}
    </div>}
    {cursor && <button className="load-more" disabled={busy} onClick={() => void load(true, cursor)}>{busy ? "Loading…" : "Load more"}</button>}
    {detail && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setDetail(null)}><section className="moderation-detail" role="dialog" aria-modal="true" aria-label={`Private details for ${detail.event.title}`}><header><div><span className="eyebrow pink">PRIVILEGED EVENT DATA</span><h2>{detail.event.title}</h2></div><button onClick={() => setDetail(null)} aria-label="Close"><X /></button></header><p>{detail.event.description}</p><dl><div><dt>Status</dt><dd>{detail.event.status}</dd></div><div><dt>Venue</dt><dd>{detail.event.venueName}, {detail.event.venueAddress}</dd></div><div><dt>Reviewer</dt><dd>{detail.event.reviewedBy || "Not reviewed"}</dd></div></dl><h3>Registration form</h3>{detail.event.customFormSchema.fields.length ? detail.event.customFormSchema.fields.map((field) => <p key={field.id}>{field.label} {field.required ? "(required)" : ""}</p>) : <p>No custom questions.</p>}<h3>Attendees and private answers</h3>{detail.attendees.length ? detail.attendees.map((attendee) => <article className="attendee-private" key={attendee.rsvpId}><b>{attendee.username}</b><small>{attendee.email} · {attendee.checkInCode} · {attendee.status}</small><pre>{JSON.stringify(attendee.customFormAnswers, null, 2)}</pre></article>) : <p>No registrations.</p>}</section></div>}
  </div>;
}

export function InstituteDashboard({ user, communities, notify, onCreateCommunity, onCreateEvent, onCommunityChanged }: {
  user: SessionUser;
  communities: Community[];
  notify: (message: string) => void;
  onCreateCommunity?: (institute: InstituteSummary) => void;
  onCreateEvent?: (institute: InstituteSummary) => void;
  onCommunityChanged?: (community: Community) => void;
}) {
  const [institutes, setInstitutes] = useState<InstituteSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [data, setData] = useState<InstituteWorkspace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<UserSearchResult[]>([]);
  const [newInstituteName, setNewInstituteName] = useState("");
  const [newInstituteDescription, setNewInstituteDescription] = useState("");
  const [importCommunityId, setImportCommunityId] = useState("");
  const [creating, setCreating] = useState(false);
  const isGlobalModerator = user.appRole === "SUPER_ADMIN" || user.appRole === "APP_MODERATOR";
  const selectedInstitute = institutes.find((item) => item.id === selected);
  const canManageMembers = isGlobalModerator || selectedInstitute?.role === "INSTITUTE_ADMIN";
  const importableCommunities = communities.filter((community) => !community.instituteId && (isGlobalModerator || community.role === "COMMUNITY_ADMIN"));

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const result = await api<Partial<InstituteWorkspace> & Pick<InstituteWorkspace, "institute">>(`/api/institutes/${encodeURIComponent(id)}`);
      setData({
        institute: result.institute,
        role: result.role || null,
        canApprove: Boolean(result.canApprove),
        canApproveEvents: Boolean(result.canApproveEvents),
        members: Array.isArray(result.members) ? result.members : [],
        communities: Array.isArray(result.communities) ? result.communities : [],
        pendingCommunities: Array.isArray(result.pendingCommunities) ? result.pendingCommunities : [],
        pendingEvents: Array.isArray(result.pendingEvents) ? result.pendingEvents : [],
      });
    }
    catch (loadError) { setData(null); setError(loadError instanceof Error ? loadError.message : "Could not load institute."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void api<{ institutes: InstituteSummary[] }>("/api/institutes")
      .then((result) => {
        if (!active) return;
        setInstitutes(result.institutes);
        const first = result.institutes.find((item) => isGlobalModerator || item.role) || null;
        if (first) { setSelected(first.id); void load(first.id); }
        else setLoading(false);
      })
      .catch((loadError) => { if (active) { setLoading(false); setError(loadError instanceof Error ? loadError.message : "Could not load institutes."); } });
    return () => { active = false; };
  }, [isGlobalModerator, load]);

  useEffect(() => {
    if (!selected) return;
    const timer = window.setTimeout(() => void load(selected), 0);
    return () => window.clearTimeout(timer);
  }, [communities, load, selected]);

  useEffect(() => {
    const query = memberQuery.trim();
    if (!canManageMembers || query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((result) => setMemberResults(result.users))
        .catch((searchError) => { if ((searchError as Error).name !== "AbortError") setMemberResults([]); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canManageMembers, memberQuery]);

  function chooseInstitute(id: string) {
    setSelected(id);
    setData(null);
    setImportCommunityId("");
    void load(id);
  }

  async function review(kind: "communities" | "events", itemId: string, status: "APPROVED" | "REJECTED") {
    if (!selected) return;
    setAction(itemId);
    try {
      const result = await api<{ community?: Community; event?: CampusEvent }>(`/api/institutes/${selected}/${kind}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "communities" ? { communityId: itemId, status } : { eventId: itemId, status }) });
      if (result.community) onCommunityChanged?.(result.community);
      notify(`${kind === "communities" ? "Community" : "Event"} ${status.toLowerCase()}`);
      await load(selected);
    } catch (reviewError) { notify(reviewError instanceof Error ? reviewError.message : "Action failed."); }
    finally { setAction(""); }
  }

  async function assignMember(userId: string, role: "INSTITUTE_ADMIN" | "INSTITUTE_MODERATOR") {
    if (!selected) return;
    setAction(userId);
    try {
      await api(`/api/institutes/${selected}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role }) });
      setMemberQuery(""); setMemberResults([]); notify(role === "INSTITUTE_ADMIN" ? "Institute admin assigned" : "Institute moderator assigned"); await load(selected);
    } catch (assignError) { notify(assignError instanceof Error ? assignError.message : "Could not update the member."); }
    finally { setAction(""); }
  }

  async function removeMember(member: InstituteMemberView) {
    if (!selected || !window.confirm(`Remove ${member.username} from this institute?`)) return;
    setAction(member.userId);
    try { await api(`/api/institutes/${selected}/members?userId=${encodeURIComponent(member.userId)}`, { method: "DELETE" }); notify("Institute member removed"); await load(selected); }
    catch (removeError) { notify(removeError instanceof Error ? removeError.message : "Could not remove the member."); }
    finally { setAction(""); }
  }

  async function membership(institute: InstituteSummary) {
    const joining = !institute.role;
    setAction(institute.id);
    try {
      await api(`/api/institutes/${institute.id}/membership`, { method: joining ? "POST" : "DELETE" });
      const role = joining ? "INSTITUTE_MEMBER" : null;
      setInstitutes((current) => current.map((item) => item.id === institute.id ? { ...item, role } : item));
      if (joining) { setSelected(institute.id); await load(institute.id); }
      else { setData(null); setSelected(""); }
      notify(joining ? "Institute joined" : "Institute left");
    } catch (membershipError) { notify(membershipError instanceof Error ? membershipError.message : "Could not update Institute membership."); }
    finally { setAction(""); }
  }

  async function importCommunity() {
    if (!selected || !importCommunityId) return;
    setAction(importCommunityId);
    try {
      const result = await api<{ community: Community }>(`/api/institutes/${selected}/communities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ communityId: importCommunityId }) });
      onCommunityChanged?.(result.community);
      setImportCommunityId(""); notify("Community imported and sent for institute verification"); await load(selected);
    } catch (importError) { notify(importError instanceof Error ? importError.message : "Could not import the community."); }
    finally { setAction(""); }
  }

  async function createInstitute() {
    if (!newInstituteName.trim()) return;
    setCreating(true); setError("");
    try {
      const result = await api<{ institute: Institute }>("/api/institutes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newInstituteName, description: newInstituteDescription }) });
      setInstitutes((current) => [...current, { ...result.institute, role: "INSTITUTE_ADMIN" }]); setSelected(result.institute.id); setNewInstituteName(""); setNewInstituteDescription(""); notify("Institute created"); await load(result.institute.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the institute."); }
    finally { setCreating(false); }
  }
  return <div className="content-page moderation-page">
    <section className="page-hero moderation-hero"><div><span className="eyebrow lime">INSTITUTES</span><h1>Institute directory.</h1><p>Join an institute, build verified <b>ic\community</b> spaces, and publish events under the right moderation team.</p></div><ShieldCheck size={58} /></section>
    {isGlobalModerator && <section className="moderation-list"><h2>Set up an Institute</h2><article><div><input value={newInstituteName} onChange={(event) => setNewInstituteName(event.target.value)} placeholder="Institute name" maxLength={120} /><input value={newInstituteDescription} onChange={(event) => setNewInstituteDescription(event.target.value)} placeholder="Description (optional)" maxLength={500} /></div><button className="approve-action" disabled={creating || !newInstituteName.trim()} onClick={() => void createInstitute()}>{creating ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Create Institute</button></article></section>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {institutes.length ? <div className="moderation-list institute-directory"><h2>All Institutes</h2>{institutes.map((institute) => <article key={institute.id}><div><b>{institute.name}</b><small>{institute.description || "No description provided."}</small></div>{institute.role && <StatusBadge value={institute.role} />}{isGlobalModerator || institute.role ? <button disabled={action === institute.id} onClick={() => chooseInstitute(institute.id)}>Open</button> : <button className="approve-action" disabled={action === institute.id} onClick={() => void membership(institute)}>Join</button>}{institute.role === "INSTITUTE_MEMBER" && <button disabled={action === institute.id} onClick={() => void membership(institute)}>Leave</button>}</article>)}</div> : !loading && <div className="moderation-empty"><ShieldCheck /><b>No Institutes yet</b><span>{isGlobalModerator ? "Create the first Institute above." : "A Super Admin or app moderator must set one up."}</span></div>}
    {loading && <div className="moderation-loading"><LoaderCircle className="spin" /> Loading institute…</div>}
    {data && selectedInstitute && <>
      <section className="institute-workspace-head"><div><span className="eyebrow cyan">INSTITUTE WORKSPACE</span><h2>{data.institute.name}</h2><p>{data.institute.description || "A verified home for institute communities and events."}</p></div><div><button className="primary-action" onClick={() => onCreateCommunity?.(selectedInstitute)}><Plus size={17} /> Create ic\community</button><button className="outline-button" onClick={() => onCreateEvent?.(selectedInstitute)}><Plus size={17} /> Create event</button></div></section>
      <div className="moderation-list"><h2>Institute communities</h2>{data.communities.map((community) => <article key={community.id}><div><b>{community.name}</b><small>{community.description}</small></div><StatusBadge value={community.status} /></article>)}{!data.communities.length && <p className="moderation-muted">No communities have been created under this institute.</p>}</div>
      {canManageMembers && <div className="moderation-list"><h2>Import an existing community</h2><article><div><select value={importCommunityId} onChange={(event) => setImportCommunityId(event.target.value)}><option value="">Choose a community you administer</option>{importableCommunities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}</select><small>The community and its events will be renamed into the ic\ namespace and sent for verification.</small></div><button disabled={!importCommunityId || action === importCommunityId} onClick={() => void importCommunity()}>Import</button></article></div>}
      {(data.canApprove || data.canApproveEvents) && <div className="moderation-list">{data.canApprove && <><h2>Pending communities</h2>{data.pendingCommunities.map((community) => <article key={community.id}><div><b>{community.name}</b><small>{community.description}</small></div><button disabled={action === community.id} onClick={() => void review("communities", community.id, "REJECTED")}><X size={15} /> Reject</button><button className="approve-action" disabled={action === community.id} onClick={() => void review("communities", community.id, "APPROVED")}><Check size={15} /> Verify</button></article>)}{!data.pendingCommunities.length && <p className="moderation-muted">No communities are waiting for verification.</p>}</>}{data.canApproveEvents && <><h2>Pending events</h2>{data.pendingEvents.map((event) => <article key={event.id}><div><b>{event.title}</b><small>{event.community ? `${event.community} · ` : "Institute event · "}{event.campus}</small></div><button disabled={action === event.id} onClick={() => void review("events", event.id, "REJECTED")}><X size={15} /> Reject</button><button className="approve-action" disabled={action === event.id} onClick={() => void review("events", event.id, "APPROVED")}><Check size={15} /> Verify</button></article>)}{!data.pendingEvents.length && <p className="moderation-muted">No events are waiting for verification.</p>}</>}</div>}
      <div className="moderation-list"><h2>Institute team</h2>{canManageMembers && <><article><div><b>Add an administrator or moderator</b><input value={memberQuery} onChange={(event) => { setMemberQuery(event.target.value); if (event.target.value.trim().length < 2) setMemberResults([]); }} placeholder="Search username" /></div></article>{memberResults.map((candidate) => <article key={candidate.id}><div><b>{candidate.username}</b><small>{candidate.about || "Smart Campus member"}</small></div><button disabled={action === candidate.id} onClick={() => void assignMember(candidate.id, "INSTITUTE_MODERATOR")}>Make moderator</button>{isGlobalModerator && <button className="approve-action" disabled={action === candidate.id} onClick={() => void assignMember(candidate.id, "INSTITUTE_ADMIN")}>Make admin</button>}</article>)}</>}{data.members.map((member) => <article key={member.userId}><div><b>{member.username}</b></div><StatusBadge value={member.role} />{canManageMembers && member.userId !== user.id && (member.role !== "INSTITUTE_ADMIN" || isGlobalModerator) && <button className="danger-action" disabled={action === member.userId} onClick={() => void removeMember(member)}><Trash2 size={14} /> Remove</button>}</article>)}</div>
    </>}
  </div>;
}

export function CommunityModerationPanel({ community, posts, canApproveEvents, onPostDeleted, onCommentDeleted, notify }: { community: Community; posts: Post[]; canApproveEvents: boolean; onPostDeleted: (id: number) => void; onCommentDeleted: (postId: number, commentId: string) => void; notify: (message: string) => void }) {
  const [events, setEvents] = useState<CampusEvent[]>([]);
  const [liveEvents, setLiveEvents] = useState<CampusEvent[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [action, setAction] = useState("");
  const canManageRoles = community.role === "COMMUNITY_ADMIN";

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [eventPage, publicEvents] = await Promise.all([
        canApproveEvents ? api<Page<CampusEvent>>(`/api/communities/${encodeURIComponent(community.id)}/events/pending`) : Promise.resolve({ items: [], nextCursor: null }),
        api<{ events: CampusEvent[] }>("/api/events"),
      ]);
      setEvents(eventPage.items);
      setLiveEvents(publicEvents.events.filter((event) => event.community === community.id && event.status === "APPROVED"));
      if (canManageRoles) setMembers((await api<Page<CommunityMember>>(`/api/communities/${encodeURIComponent(community.id)}/members?limit=100`)).items);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load community moderation."); }
    finally { setBusy(false); }
  }, [canApproveEvents, canManageRoles, community.id, notify]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function review(event: CampusEvent, status: "APPROVED" | "REJECTED") {
    setAction(event.id);
    try { await api(`/api/communities/${encodeURIComponent(community.id)}/events/${event.id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); setEvents((current) => current.filter((item) => item.id !== event.id)); notify(`Event ${status.toLowerCase()}`); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not review the event."); }
    finally { setAction(""); }
  }

  async function removePost(post: Post) {
    if (!window.confirm(`Delete “${post.title}” and all of its comments?`)) return;
    setAction(String(post.id));
    try { await api(`/api/moderation/posts/${post.id}`, { method: "DELETE" }); onPostDeleted(post.id); notify("Post deleted"); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not delete the post."); }
    finally { setAction(""); }
  }

  async function removeEvent(event: CampusEvent) {
    if (!window.confirm(`Delete “${event.title}” permanently?`)) return;
    setAction(event.id);
    try { await api(`/api/moderation/events/${event.id}`, { method: "DELETE" }); setEvents((current) => current.filter((item) => item.id !== event.id)); setLiveEvents((current) => current.filter((item) => item.id !== event.id)); notify("Event deleted"); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not delete the event."); }
    finally { setAction(""); }
  }

  async function removeComment(post: Post, commentId: string) {
    if (!window.confirm("Delete this comment permanently?")) return;
    setAction(commentId);
    try { await api(`/api/moderation/posts/${post.id}/comments/${commentId}`, { method: "DELETE" }); onCommentDeleted(post.id, commentId); notify("Comment deleted"); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not delete the comment."); }
    finally { setAction(""); }
  }

  async function memberRole(member: CommunityMember, role: "MEMBER" | "COMMUNITY_MODERATOR") {
    setAction(member.userId);
    try { await api(`/api/communities/${encodeURIComponent(community.id)}/members/${member.userId}/role`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ communityRole: role }) }); setMembers((current) => current.map((item) => item.userId === member.userId ? { ...item, role } : item)); notify("Community role updated"); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not update the community role."); }
    finally { setAction(""); }
  }

  return <section className="community-moderation-panel">
    <header><div><span className="eyebrow pink">MODERATION</span><h2>Review queue</h2><p>Community events stay hidden until your team approves them.</p></div><ShieldCheck size={38} /></header>
    {busy ? <div className="moderation-loading"><LoaderCircle className="spin" /> Loading queue…</div> : <>
      {canApproveEvents && <div className="moderation-section"><h3>Pending events <b>{events.length}</b></h3>
        {events.map((event) => <article className="queue-card" key={event.id}><div><StatusBadge value={event.status} /><h4>{event.title}</h4><p>{event.description || "No description supplied."}</p><small>{event.venueName} · {event.campus} · submitted {date(event.createdAt)}</small>{event.customFormSchema.fields.length > 0 && <details><summary>Registration questions</summary>{event.customFormSchema.fields.map((field) => <span key={field.id}>{field.label}{field.required ? " *" : ""}</span>)}</details>}</div><footer><button className="danger-action" disabled={action === event.id} onClick={() => void removeEvent(event)}><Trash2 size={15} /> Delete</button><button disabled={action === event.id} onClick={() => void review(event, "REJECTED")}><X size={15} /> Reject</button><button className="approve-action" disabled={action === event.id} onClick={() => void review(event, "APPROVED")}><Check size={15} /> Approve</button></footer></article>)}
        {!events.length && <div className="moderation-empty"><Check /><b>Queue cleared</b><span>No events are waiting for review.</span></div>}
      </div>}
      <div className="moderation-section"><h3>Community content</h3>
        {posts.map((post) => <article className="community-moderation-post" key={post.id}><div><b>{post.title}</b><small>{post.author} · {post.comments} comments</small>{post.commentItems?.map((comment) => <span className="moderation-comment" key={comment.id}>{comment.author}: {comment.body}<button disabled={action === comment.id} onClick={() => void removeComment(post, comment.id)} aria-label={`Delete comment by ${comment.author}`}><Trash2 size={13} /></button></span>)}</div><button className="danger-action" disabled={action === String(post.id)} onClick={() => void removePost(post)}><Trash2 size={14} /> Delete</button></article>)}
        {!posts.length && <p className="moderation-muted">No community posts.</p>}
      </div>
      <div className="moderation-section"><h3>Live events</h3>{liveEvents.map((event) => <article className="community-moderation-post" key={event.id}><div><b>{event.title}</b><small>{event.venueName} · {eventWhenLabel(event)}</small></div><button className="danger-action" disabled={action === event.id} onClick={() => void removeEvent(event)}><Trash2 size={14} /> Delete</button></article>)}{!liveEvents.length && <p className="moderation-muted">No approved community events.</p>}</div>
      {canManageRoles && <div className="moderation-section"><h3><UserCog size={17} /> Member roles</h3><label className="member-search"><Search size={15} /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search members" /></label>{members.filter((member) => member.username.toLowerCase().includes(memberQuery.trim().toLowerCase())).map((member) => <article className="member-role-row" key={member.id}><div><b>{member.username}</b><small>{member.role.replaceAll("_", " ")}{member.inherited ? ` · Inherited from ${member.inheritedFromCommunityName || "parent community"}` : ""}</small></div>{!member.readOnly && member.role !== "COMMUNITY_ADMIN" && <select disabled={action === member.userId} value={member.role} onChange={(event) => void memberRole(member, event.target.value as "MEMBER" | "COMMUNITY_MODERATOR")}><option value="MEMBER">Member</option><option value="COMMUNITY_MODERATOR">Moderator</option></select>}</article>)}</div>}
    </>}
  </section>;
}
