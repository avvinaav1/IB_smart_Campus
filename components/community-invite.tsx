"use client";

import Image from "next/image";
import { Check, Copy, Download, Link2, LoaderCircle, Mail, QrCode, RefreshCw, Search, Send, Share2, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Community, CommunityRole, UserSearchResult } from "@/lib/types";

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json() as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result.data;
}

function MemberAvatar({ name, image }: { name: string; image?: string }) {
  return <span className="avatar" style={{ background: "#6C3BFF", width: 38, height: 38 }}>{image ? <Image src={image} alt="" fill sizes="38px" unoptimized /> : name.slice(0, 2).toUpperCase()}</span>;
}

type InviteTab = "link" | "qr" | "search" | "email";

export function InviteMembersModal({ community, close, notify, intro }: { community: Pick<Community, "id" | "name">; close: () => void; notify?: (message: string) => void; intro?: string }) {
  const base = `/api/communities/${encodeURIComponent(community.id)}/invite`;
  const [tab, setTab] = useState<InviteTab>("link");
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrVersion, setQrVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserSearchResult[]>([]);
  const [emails, setEmails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function announce(message: string) {
    setNotice(message);
    notify?.(message);
  }

  useEffect(() => {
    let active = true;
    requestJson<{ url: string }>(base, { cache: "no-store" })
      .then((data) => { if (active) setLink(data?.url || ""); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the invite link."); })
      .finally(() => { if (active) setLinkBusy(false); });
    return () => { active = false; };
  }, [base]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const data = await requestJson<{ users: UserSearchResult[] }>(`/api/users/search?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        setResults(data?.users || []);
      } catch (searchError) {
        if (!controller.signal.aborted) setError(searchError instanceof Error ? searchError.message : "Could not search users.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy automatically — select the link and copy it.");
    }
  }

  async function shareLink() {
    if (!link) return;
    if (typeof navigator.share !== "function") return copyLink();
    try { await navigator.share({ title: `Join ${community.name}`, text: `Join ${community.name} on Smart Campus`, url: link }); }
    catch { /* dismissed */ }
  }

  async function resetLink() {
    setLinkBusy(true);
    setError("");
    try {
      const data = await requestJson<{ url: string }>(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate: true }) });
      setLink(data?.url || "");
      setQrVersion((current) => current + 1);
      announce("Invite link reset — the old link no longer works");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset the invite link.");
    } finally {
      setLinkBusy(false);
    }
  }

  function toggle(user: UserSearchResult) {
    setSelected((current) => current.some((item) => item.id === user.id) ? current.filter((item) => item.id !== user.id) : current.length >= 20 ? current : [...current, user]);
  }

  async function send(payload: { userIds: string[] } | { emails: string[] }) {
    setSending(true);
    setError("");
    setNotice("");
    try {
      const data = await requestJson<{ invited: number; skipped?: number; failed?: string[] }>(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const invited = data?.invited || 0;
      if ("userIds" in payload) {
        setSelected([]);
        announce(invited ? `Invited ${invited} ${invited === 1 ? "person" : "people"}${data?.skipped ? ` · ${data.skipped} already in` : ""}` : "Everyone you picked is already a member");
      } else {
        setEmails("");
        announce(`Sent ${invited} invite ${invited === 1 ? "email" : "emails"}${data?.failed?.length ? ` · ${data.failed.length} failed` : ""}`);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send invites.");
    } finally {
      setSending(false);
    }
  }

  const hasQuery = Boolean(query.trim());
  const shownResults = hasQuery ? results : [];
  const emailList = [...new Set(emails.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];

  return <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="creation-modal invite-modal" role="dialog" aria-label={`Invite members to ${community.name}`}>
      <header><div><span className="eyebrow cyan">GROW YOUR CIRCLE</span><h2>Invite members</h2><p>{intro || `Bring people into ${community.name}.`}</p></div><button type="button" className="icon-button" aria-label="Close" onClick={close}><X size={20} /></button></header>
      <nav className="community-detail-tabs invite-tabs" role="tablist">
        {([["link", "Share link", Link2], ["qr", "QR code", QrCode], ["search", "Find people", Search], ["email", "Send email", Mail]] as const).map(([value, label, Icon]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} onClick={() => { setTab(value); setError(""); setNotice(""); }}><Icon size={14} /> {label}</button>)}
      </nav>

      {tab === "link" && <div className="invite-pane">
        <p className="invite-hint">Anyone with this link can join. Reset it any time to stop old links from working.</p>
        <div className="invite-link-row"><input readOnly value={linkBusy ? "Loading invite link…" : link} onFocus={(event) => event.currentTarget.select()} aria-label="Invite link" /><button type="button" className="post-button" onClick={() => void copyLink()} disabled={!link || linkBusy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}</button></div>
        <div className="invite-actions"><button type="button" className="draft-button" onClick={() => void shareLink()} disabled={!link || linkBusy}><Share2 size={15} /> Share</button><button type="button" className="draft-button" onClick={() => void resetLink()} disabled={linkBusy}><RefreshCw size={15} /> Reset link</button></div>
      </div>}

      {tab === "qr" && <div className="invite-pane invite-qr-pane">
        <p className="invite-hint">Scanning this code opens {community.name} and makes the person a member right after they sign in. Resetting the link also replaces this code.</p>
        <div className="invite-qr-frame">{linkBusy || !link ? <LoaderCircle className="spin" size={22} /> : <Image src={`${base}/qr?v=${qrVersion}`} alt={`QR code to join ${community.name}`} width={220} height={220} unoptimized />}</div>
        <div className="invite-actions"><a className="draft-button" href={`${base}/qr?format=png&download=1`} download aria-disabled={!link || linkBusy}><Download size={15} /> Download PNG</a><a className="draft-button" href={`${base}/qr?download=1`} download aria-disabled={!link || linkBusy}><Download size={15} /> Download SVG</a><button type="button" className="draft-button" onClick={() => void resetLink()} disabled={linkBusy}><RefreshCw size={15} /> Reset code</button></div>
      </div>}

      {tab === "search" && <div className="invite-pane">
        <label className="field"><span>Search by username</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing a name" maxLength={50} /></label>
        {selected.length > 0 && <div className="invite-chips">{selected.map((user) => <button type="button" key={user.id} onClick={() => toggle(user)}>@{user.username} <X size={12} /></button>)}</div>}
        <div className="admin-search-results invite-results">
          {searching && hasQuery && <p className="invite-hint"><LoaderCircle className="spin" size={14} /> Searching…</p>}
          {!searching && hasQuery && !results.length && <p className="invite-hint">No one matches “{query.trim()}”.</p>}
          {shownResults.map((user) => { const picked = selected.some((item) => item.id === user.id); return <button type="button" key={user.id} aria-pressed={picked} onClick={() => toggle(user)}><MemberAvatar name={user.username} image={user.avatarUrl} /><span><b>@{user.username}</b><small>{user.about || "Smart Campus member"}</small></span>{picked ? <Check size={16} /> : <UserPlus size={16} />}</button>; })}
        </div>
        <footer><button type="button" className="post-button" disabled={!selected.length || sending} onClick={() => void send({ userIds: selected.map((user) => user.id) })}>{sending ? <><LoaderCircle className="spin" size={16} /> Inviting…</> : <><Send size={16} /> Invite {selected.length || ""}</>}</button></footer>
      </div>}

      {tab === "email" && <div className="invite-pane">
        <label className="field"><span>Email addresses</span><textarea autoFocus rows={4} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={"friend@college.edu, another@gmail.com"} /><small>Separate with commas or new lines · up to 20 at a time · {emailList.length} added</small></label>
        <footer><button type="button" className="post-button" disabled={!emailList.length || emailList.length > 20 || sending} onClick={() => void send({ emails: emailList })}>{sending ? <><LoaderCircle className="spin" size={16} /> Sending…</> : <><Mail size={16} /> Send invites</>}</button></footer>
      </div>}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && !error && <p className="invite-notice" role="status"><Check size={14} /> {notice}</p>}
      {intro && <footer><button type="button" className="post-button" onClick={close}>Done</button></footer>}
    </section>
  </div>;
}

type MemberRow = { userId: string; username: string; avatarUrl?: string; role: CommunityRole; createdAt: number; inherited: boolean; inheritedFromCommunityName: string | null };

const roleLabel: Partial<Record<CommunityRole, string>> = { COMMUNITY_ADMIN: "Admin", COMMUNITY_MODERATOR: "Moderator" };

export function CommunityMembersList({ community, canInvite, onInvite }: { community: Pick<Community, "id" | "name" | "updatedAt">; canInvite: boolean; onInvite: () => void }) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    requestJson<{ items: MemberRow[] }>(`/api/communities/${encodeURIComponent(community.id)}/members?limit=100`, { cache: "no-store" })
      .then((data) => { if (active) { setMembers(data?.items || []); setError(""); } })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load members."); });
    return () => { active = false; };
  }, [community.id, community.updatedAt]);

  const normalized = query.trim().toLowerCase();
  const visible = (members || []).filter((member) => !normalized || member.username.toLowerCase().includes(normalized));

  return <section className="community-members">
    <header><div><span className="eyebrow violet">MEMBERS</span><h2>Who&apos;s in {community.name}</h2></div>{canInvite && <button className="primary-action" onClick={onInvite}><UserPlus size={17} /> Invite members</button>}</header>
    {members && members.length > 8 && <label className="community-members-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" /></label>}
    {error ? <p className="form-error" role="alert">{error}</p> : !members ? <p className="invite-hint"><LoaderCircle className="spin" size={14} /> Loading members…</p> : visible.length ? <div className="community-members-list">{visible.map((member) => <a key={member.userId} href={`/members/${encodeURIComponent(member.userId)}`}>
      <MemberAvatar name={member.username} image={member.avatarUrl} />
      <span><b>@{member.username}</b><small>{member.inherited && member.inheritedFromCommunityName ? `Admin via ${member.inheritedFromCommunityName}` : `Joined ${new Date(member.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`}</small></span>
      {roleLabel[member.role] && <em><ShieldCheck size={12} /> {roleLabel[member.role]}</em>}
    </a>)}</div> : <div className="community-empty"><span><Users size={26} /></span><h3>{normalized ? "No members match that search." : "No members yet."}</h3></div>}
  </section>;
}
