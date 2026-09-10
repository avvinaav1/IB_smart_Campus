"use client";
/* eslint-disable @next/next/no-img-element -- Authenticated image routes are intentionally served directly. */
import { useCallback, useEffect, useState } from "react";
import { Award, Download, Upload, Globe2, LockKeyhole, Trash2 } from "lucide-react";
import { badgeFor, type CertificateRecord, type CertificateStats, type InboxMessage } from "@/lib/certificates/model";
import { certificateRequest, jsonRequest, uploadCertificateAsset } from "./client";

export function CertificateBadge({ count }: { count: number }) {
  const tier = badgeFor(count);
  return <span className={`certificate-badge tier-${tier.toLowerCase()}`} title={`${count} certificates, including self-uploaded certificates`}><Award size={21} /><span><b>{tier === "None" ? "Your next achievement awaits" : `${tier} Badge`}</b><small>{count} {count === 1 ? "certificate" : "certificates"}</small></span></span>;
}
type GalleryData = { certificates: CertificateRecord[]; stats: CertificateStats; nextCursor: string | null; user?: { username: string; about: string; avatarUrl: string } };
export function CertificateGallery({ userId, owner = true, preview = false, onBuild }: { userId: string; owner?: boolean; preview?: boolean; onBuild?: () => void }) {
  const [data, setData] = useState<GalleryData>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState(""), [issuer, setIssuer] = useState(""), [file, setFile] = useState<File>();
  const [pendingUpload, setPendingUpload] = useState<{ file: File; assetId: string; key: string }>();
  const refresh = useCallback(async () => { if (preview) return; try { setData(await certificateRequest<GalleryData>(owner ? "" : `/profiles/${userId}`)); setError(""); } catch (e) { setError((e as Error).message); } }, [preview, owner, userId]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer); }, [refresh]);
  async function upload() {
    if (!file || !title.trim() || !issuer.trim()) { setError("Add a title, issuer and certificate image."); return; }
    if (!/image\/(png|jpeg|webp)/.test(file.type) || file.size > 8 * 1024 * 1024) { setError("Choose a PNG, JPG or WebP up to 8 MB."); return; }
    setBusy(true); setError("");
    try {
      const pending = pendingUpload?.file === file ? pendingUpload : { file, assetId: (await uploadCertificateAsset(file, "certificate")).assetId, key: crypto.randomUUID() };
      setPendingUpload(pending);
      await certificateRequest("/external", jsonRequest({ assetId: pending.assetId, title, issuerName: issuer, key: pending.key }));
      setShowUpload(false); setFile(undefined); setTitle(""); setIssuer(""); setPendingUpload(undefined); await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function change(id: string, action: string) {
    if (action === "deleted" && !window.confirm("Remove this certificate from your profile? Your badge count will update.")) return;
    setBusy(true); try { await certificateRequest(`/${id}`, jsonRequest({ action }, "PATCH")); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="certificate-gallery">
    {!owner && data?.user && <header className="certificate-public-profile">{data.user.avatarUrl && <img src={data.user.avatarUrl} alt="" />}<div><span className="eyebrow violet">SMART CAMPUS PROFILE</span><h1>{data.user.username}</h1><p>{data.user.about}</p></div><CertificateBadge count={data.stats.certificateCount} /></header>}
    <header className="cert-gallery-head"><div><span className="eyebrow violet">YOUR WORK, RECOGNIZED</span><h2>{owner ? "My certificates" : "Earned certificates"}</h2></div>{owner && <CertificateBadge count={data?.stats.certificateCount || 0} />}</header>
    <p className="cert-help">Beginner: 1–2 · Intermediate: 3–5 · Expert: 6+ certificates. Internal awards and self-uploaded certificates both count.</p>
    {owner && <div className="cert-actions"><button disabled={preview} onClick={() => setShowUpload(v => !v)}><Upload size={17} />Upload External Certificate</button>{onBuild && <button className="cert-primary" onClick={onBuild}><Award size={17} />Open certificate studio</button>}<a href={`/members/${userId}`} target="_blank" rel="noreferrer">View public profile</a></div>}
    {preview && <p className="cert-note">Sign in to upload certificates and see your saved awards.</p>}{error && <p className="cert-error" role="alert">{error}</p>}
    {showUpload && <form className="cert-external-form" onSubmit={e => { e.preventDefault(); void upload(); }}><label>Certificate title<input value={title} maxLength={160} required onChange={e => setTitle(e.target.value)} /></label><label>Issued by<input value={issuer} maxLength={160} required onChange={e => setIssuer(e.target.value)} /></label><label>Certificate image<input type="file" accept="image/png,image/jpeg,image/webp" required onChange={e => { setFile(e.target.files?.[0]); setPendingUpload(undefined); }} /></label><p>Self-uploaded certificates start private. You can make them public after uploading.</p><button className="cert-primary" disabled={busy}>{busy ? "Saving…" : "Save certificate"}</button></form>}
    <div className="cert-gallery-grid">{data?.certificates.map(c => <article className="cert-card" key={c.id}><a href={`${c.imageUrl}?download=1`}><img loading="lazy" src={c.imageUrl} alt={c.title} /></a><div><span className={`cert-source ${c.source}`}>{c.source === "internal" ? "Smart Campus award" : "Self-uploaded"}</span><h3>{c.title}</h3><p>{c.issuerName} · {new Date(c.createdAt).toLocaleDateString()}</p><footer><a href={`${c.imageUrl}?download=1`}><Download size={16} />PNG</a>{owner && <><button disabled={busy} onClick={() => void change(c.id, c.visibility === "public" ? "private" : "public")}>{c.visibility === "public" ? <Globe2 size={16} /> : <LockKeyhole size={16} />}{c.visibility}</button><button disabled={busy} aria-label={`Remove ${c.title}`} onClick={() => void change(c.id, "deleted")}><Trash2 size={16} /></button></>}</footer></div></article>)}</div>
    {!data?.certificates.length && !error && <div className="cert-empty"><Award size={40} /><h3>{owner ? "Make room for your next milestone" : "No public certificates yet"}</h3><p>{owner ? "Certificates you receive or upload will live here." : "This member has not shared any certificates publicly."}</p></div>}
    {data?.nextCursor && <button onClick={async () => { try { const next = await certificateRequest<GalleryData>(`${owner ? "" : `/profiles/${userId}`}?cursor=${data.nextCursor}`); setData({ ...next, user: data.user, certificates: [...data.certificates, ...next.certificates] }); } catch (e) { setError((e as Error).message); } }}>Load more certificates</button>}
  </section>;
}

export function CertificateInbox({ preview = false }: { preview?: boolean }) {
  const [messages, setMessages] = useState<InboxMessage[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (preview) return;
    let active = true, first = true;
    const refresh = async () => { try { const data = await certificateRequest<{ messages: InboxMessage[]; nextCursor: string | null }>("/inbox"); if (active) { setMessages(current => current.length > 24 ? [...data.messages, ...current.slice(24)] : data.messages); if (first) { setCursor(data.nextCursor); first = false; } } } catch (e) { if (active) setError((e as Error).message); } };
    void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [preview]);
  return <section className="thread certificate-inbox"><header><Award size={32} /><div><b>Smart Campus Certificates</b><small>Your awards, delivered directly to you</small></div></header>{error && <p className="cert-error">{error}</p>}<div className="certificate-messages">{messages.map(m => <article key={m.id} className="certificate-message"><span className="cert-source internal">{m.readAt ? "Certificate received" : "New certificate"}</span><h3>{m.title}</h3><p>{m.body}</p><img loading="lazy" src={m.imageUrl} alt={m.title} /><footer><a href={`${m.imageUrl}?download=1`}><Download size={16} />Download certificate</a>{!m.readAt && <button onClick={async () => { try { await certificateRequest(`/inbox/${m.id}`, { method: "PATCH" }); setMessages(current => current.map(item => item.id === m.id ? { ...item, readAt: Date.now() } : item)); } catch (e) { setError((e as Error).message); } }}>Mark read</button>}</footer><small>{m.issuerName} · {new Date(m.createdAt).toLocaleString()}</small></article>)}{!messages.length && <div className="cert-empty"><Award size={40} /><h3>Your achievements arrive here</h3><p>{preview ? "Sign in to receive certificates from event organizers." : "Organizer-issued certificates also appear automatically on your profile."}</p></div>}{cursor && <button onClick={async () => { try { const data = await certificateRequest<{ messages: InboxMessage[]; nextCursor: string | null }>(`/inbox?cursor=${cursor}`); setMessages(current => [...current, ...data.messages]); setCursor(data.nextCursor); } catch (e) { setError((e as Error).message); } }}>Older certificates</button>}</div></section>;
}
