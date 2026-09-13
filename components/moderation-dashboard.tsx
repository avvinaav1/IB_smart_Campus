"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Search, ShieldCheck, Trash2, UserCog, X } from "lucide-react";
import type { AppRole, CampusEvent, Community, CommunityRole, EventAttendee, EventStatus, Post, SessionUser } from "@/lib/types";

type Page<T> = { items: T[]; nextCursor: string | null };
type AdminUser = { id: string; username: string; email: string; campus: string; createdAt: number; appRole: AppRole; protected: boolean };
type AdminCommunity = { id: string; name: string; description: string; creatorId: string; privacy: string; type: string; parentId: string | null; members: number; createdAt: number };
type CommunityMember = { id: string; userId: string; username: string; avatarUrl: string; role: CommunityRole; createdAt: number; inherited: boolean; readOnly: boolean; inheritedFromCommunityName: string | null };

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
    if (!event.community) return;
    setAction(event.id);
    try {
      const result = await api<{ event: CampusEvent }>(`/api/communities/${encodeURIComponent(event.community)}/events/${event.id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
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
      {tab === "events" && (items as CampusEvent[]).map((item) => <article key={item.id}><div><b>{item.title}</b><small>{item.campus} · {date(item.createdAt)}{item.community ? ` · ${item.community}` : " · standalone"}</small></div><StatusBadge value={item.status} /><button onClick={() => void openEvent(item.id)}>Details</button>{item.status === "PENDING" && item.community && <><button className="approve-action" disabled={action === item.id} onClick={() => void review(item, "APPROVED")}><Check size={15} /> Approve</button><button disabled={action === item.id} onClick={() => void review(item, "REJECTED")}><X size={15} /> Reject</button></>}<button className="danger-action" disabled={action === item.id} onClick={() => void remove(`/api/moderation/events/${item.id}`, item.id, item.title)}><Trash2 size={15} /> Delete</button></article>)}
      {tab === "posts" && (items as Post[]).map((item) => <article className="moderation-post" key={item.id}><div><b>{item.title}</b><small>{item.author} · {item.community} · {item.comments} comments</small>{item.commentItems?.map((comment) => <span className="moderation-comment" key={comment.id}>{comment.author}: {comment.body}<button disabled={action === comment.id} aria-label={`Delete comment by ${comment.author}`} onClick={() => void removeComment(item.id, comment.id)}><Trash2 size={13} /></button></span>)}</div><button className="danger-action" disabled={action === String(item.id)} onClick={() => void remove(`/api/moderation/posts/${item.id}`, String(item.id), item.title)}><Trash2 size={15} /> Delete</button></article>)}
      {!items.length && !busy && <div className="moderation-empty"><ShieldCheck /><b>Nothing to review</b><span>No {tab} match these filters.</span></div>}
    </div>}
    {cursor && <button className="load-more" disabled={busy} onClick={() => void load(true, cursor)}>{busy ? "Loading…" : "Load more"}</button>}
    {detail && <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && setDetail(null)}><section className="moderation-detail" role="dialog" aria-modal="true" aria-label={`Private details for ${detail.event.title}`}><header><div><span className="eyebrow pink">PRIVILEGED EVENT DATA</span><h2>{detail.event.title}</h2></div><button onClick={() => setDetail(null)} aria-label="Close"><X /></button></header><p>{detail.event.description}</p><dl><div><dt>Status</dt><dd>{detail.event.status}</dd></div><div><dt>Venue</dt><dd>{detail.event.venueName}, {detail.event.venueAddress}</dd></div><div><dt>Reviewer</dt><dd>{detail.event.reviewedBy || "Not reviewed"}</dd></div></dl><h3>Registration form</h3>{detail.event.customFormSchema.fields.length ? detail.event.customFormSchema.fields.map((field) => <p key={field.id}>{field.label} {field.required ? "(required)" : ""}</p>) : <p>No custom questions.</p>}<h3>Attendees and private answers</h3>{detail.attendees.length ? detail.attendees.map((attendee) => <article className="attendee-private" key={attendee.rsvpId}><b>{attendee.username}</b><small>{attendee.email} · {attendee.checkInCode} · {attendee.status}</small><pre>{JSON.stringify(attendee.customFormAnswers, null, 2)}</pre></article>) : <p>No registrations.</p>}</section></div>}
  </div>;
}

export function CommunityModerationPanel({ community, posts, onPostDeleted, onCommentDeleted, notify }: { community: Community; posts: Post[]; onPostDeleted: (id: number) => void; onCommentDeleted: (postId: number, commentId: string) => void; notify: (message: string) => void }) {
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
        api<Page<CampusEvent>>(`/api/communities/${encodeURIComponent(community.id)}/events/pending`),
        api<{ events: CampusEvent[] }>("/api/events"),
      ]);
      setEvents(eventPage.items);
      setLiveEvents(publicEvents.events.filter((event) => event.community === community.id && event.status === "APPROVED"));
      if (canManageRoles) setMembers((await api<Page<CommunityMember>>(`/api/communities/${encodeURIComponent(community.id)}/members?limit=100`)).items);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load community moderation."); }
    finally { setBusy(false); }
  }, [canManageRoles, community.id, notify]);
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
      <div className="moderation-section"><h3>Pending events <b>{events.length}</b></h3>
        {events.map((event) => <article className="queue-card" key={event.id}><div><StatusBadge value={event.status} /><h4>{event.title}</h4><p>{event.description || "No description supplied."}</p><small>{event.venueName} · {event.campus} · submitted {date(event.createdAt)}</small>{event.customFormSchema.fields.length > 0 && <details><summary>Registration questions</summary>{event.customFormSchema.fields.map((field) => <span key={field.id}>{field.label}{field.required ? " *" : ""}</span>)}</details>}</div><footer><button className="danger-action" disabled={action === event.id} onClick={() => void removeEvent(event)}><Trash2 size={15} /> Delete</button><button disabled={action === event.id} onClick={() => void review(event, "REJECTED")}><X size={15} /> Reject</button><button className="approve-action" disabled={action === event.id} onClick={() => void review(event, "APPROVED")}><Check size={15} /> Approve</button></footer></article>)}
        {!events.length && <div className="moderation-empty"><Check /><b>Queue cleared</b><span>No events are waiting for review.</span></div>}
      </div>
      <div className="moderation-section"><h3>Community content</h3>
        {posts.map((post) => <article className="community-moderation-post" key={post.id}><div><b>{post.title}</b><small>{post.author} · {post.comments} comments</small>{post.commentItems?.map((comment) => <span className="moderation-comment" key={comment.id}>{comment.author}: {comment.body}<button disabled={action === comment.id} onClick={() => void removeComment(post, comment.id)} aria-label={`Delete comment by ${comment.author}`}><Trash2 size={13} /></button></span>)}</div><button className="danger-action" disabled={action === String(post.id)} onClick={() => void removePost(post)}><Trash2 size={14} /> Delete</button></article>)}
        {!posts.length && <p className="moderation-muted">No community posts.</p>}
      </div>
      <div className="moderation-section"><h3>Live events</h3>{liveEvents.map((event) => <article className="community-moderation-post" key={event.id}><div><b>{event.title}</b><small>{event.venueName} · {eventWhenLabel(event)}</small></div><button className="danger-action" disabled={action === event.id} onClick={() => void removeEvent(event)}><Trash2 size={14} /> Delete</button></article>)}{!liveEvents.length && <p className="moderation-muted">No approved community events.</p>}</div>
      {canManageRoles && <div className="moderation-section"><h3><UserCog size={17} /> Member roles</h3><label className="member-search"><Search size={15} /><input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search members" /></label>{members.filter((member) => member.username.toLowerCase().includes(memberQuery.trim().toLowerCase())).map((member) => <article className="member-role-row" key={member.id}><div><b>{member.username}</b><small>{member.role.replaceAll("_", " ")}{member.inherited ? ` · Inherited from ${member.inheritedFromCommunityName || "parent community"}` : ""}</small></div>{!member.readOnly && member.role !== "COMMUNITY_ADMIN" && <select disabled={action === member.userId} value={member.role} onChange={(event) => void memberRole(member, event.target.value as "MEMBER" | "COMMUNITY_MODERATOR")}><option value="MEMBER">Member</option><option value="COMMUNITY_MODERATOR">Moderator</option></select>}</article>)}</div>}
    </>}
  </section>;
}
