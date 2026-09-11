"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Search, ShieldCheck, LoaderCircle, CircleX } from "lucide-react";
import { normalizeVerificationCode, validVerificationCode, type VerificationDetails } from "@/lib/certificates/verification-code";

export default function VerificationPortal({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerificationDetails | null>(null), [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false), attempt = useRef(0);
  async function verify(event: FormEvent) {
    event.preventDefault();
    const current = ++attempt.current, value = normalizeVerificationCode(code);
    setResult(null); setError(""); setInvalid(false);
    if (!validVerificationCode(value)) { setInvalid(true); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/certificates/verify/${encodeURIComponent(value)}`, { cache: "no-store" });
      const body = await response.json();
      if (current !== attempt.current) return;
      if (response.status === 404) setInvalid(true);
      else if (response.status === 429) setError(`Too many attempts. Please wait ${response.headers.get("Retry-After") || "60"} seconds before trying again.`);
      else if (!response.ok || !body.valid) setError(body.error || "Verification is temporarily unavailable.");
      else setResult(body.certificate);
    } catch { if (current === attempt.current) setError("Could not reach verification. Check your connection and try again."); }
    finally { if (current === attempt.current) setBusy(false); }
  }
  return <main className="verify-page">
    <nav className="verify-nav"><Link href="/" className="verify-brand">IB <span>smart campus</span> ✦</Link><Link href="/"><ArrowLeft size={15} />Back to campus</Link></nav>
    <section className="verify-intro"><span className="verify-eyebrow"><ShieldCheck size={16} /> OFFICIAL CERTIFICATE VERIFICATION</span><h1>Achievements worth<br /><em>checking.</em></h1><p>A certificate tells a story. Confirm its issuance details with the unique code printed on it.</p></section>
    <section className="verify-card" aria-labelledby="verify-title"><div className="verify-card-head"><span className="verify-shield"><ShieldCheck size={26} /></span><div><h2 id="verify-title">Verify a certificate</h2><p>Public access. No account needed.</p></div></div>
      <form onSubmit={verify}><label htmlFor="verification-code">Certificate verification code</label><div className="verify-input-row"><input id="verification-code" value={code} onChange={event => { ++attempt.current; setCode(event.target.value.toUpperCase()); setResult(null); setInvalid(false); setError(""); setBusy(false); }} placeholder="e.g. 7K3M9P2R8V4X" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} aria-describedby="verification-help" required /><button type="submit" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}{busy ? "Checking…" : "Verify code"}</button></div><p id="verification-help" className="verify-help">Enter the 12-character code exactly as printed. Uppercase and lowercase both work.</p></form>
      <div aria-live="polite" aria-atomic="true">
        {result && <article className="verify-result"><div className="verify-authentic"><BadgeCheck size={25} /><div><strong>✅ Verified Authentic</strong><small>This code matches an active IB Smart Campus certificate.</small></div></div><dl><div><dt>Recipient</dt><dd>{result.recipientName}</dd></div><div><dt>Course / event</dt><dd>{result.courseName}</dd></div><div><dt>Issue date</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(result.issuedAt)}</dd></div><div><dt>Organizer / issuer</dt><dd>{result.issuerName}</dd></div></dl><footer>Verification code <code>{result.verificationCode}</code></footer><p className="verify-help">Compare these details with the certificate you received. A matching code confirms issuance; it does not detect changes made to a copied image.</p></article>}
        {invalid && <div className="verify-invalid"><CircleX size={24} /><div><strong>❌ Invalid or Not Found</strong><p>Check the printed code and try again. Preview exports, self-uploaded certificates and removed certificates cannot be verified here.</p></div></div>}
        {error && <div className="verify-error" role="alert">{error}</div>}
      </div>
    </section>
    <section className="verify-guidance"><div><span>01</span><h3>Find the code</h3><p>Look for the verification code printed on your certificate.</p></div><div><span>02</span><h3>Check the record</h3><p>Enter it above to retrieve the original issuance details.</p></div><div><span>03</span><h3>Compare the details</h3><p>Match the recipient, event, date and issuer against your copy.</p></div></section>
    <footer className="verify-footer"><span>IB Smart Campus · Recognition with a record.</span><a href="/certificates">Certificate studio ↗</a></footer>
  </main>;
}
