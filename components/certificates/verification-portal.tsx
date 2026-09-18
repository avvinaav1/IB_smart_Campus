"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Search, ShieldCheck, LoaderCircle, CircleX, ScanLine, X } from "lucide-react";
import { normalizeVerificationCode, validVerificationCode, type VerificationDetails } from "@/lib/certificates/verification-code";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;
const noopSubscribe = () => () => {};
function scanSupported() { return typeof window !== "undefined" && "BarcodeDetector" in window && Boolean(navigator.mediaDevices?.getUserMedia); }
function scannedVerificationCode(raw: string) {
  try { const url = new URL(raw); return normalizeVerificationCode(url.searchParams.get("code") || url.pathname.split("/").filter(Boolean).at(-1) || ""); }
  catch { return normalizeVerificationCode(raw); }
}
function CertificateQrScanner({ onCode, close, onError }: { onCode: (code: string) => void; close: () => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, frame = 0, stopped = false;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) { onError("QR scanning is not supported in this browser. Enter the code instead."); close(); return; }
    const detector = new Detector({ formats: ["qr_code"] });
    async function loop() {
      if (stopped || !video.current) return;
      try {
        const found = (await detector.detect(video.current)).map(item => scannedVerificationCode(item.rawValue)).find(validVerificationCode);
        if (found) { onCode(found); return; }
      } catch { /* keep scanning */ }
      frame = requestAnimationFrame(loop);
    }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(async value => {
      stream = value; if (stopped || !video.current) return; video.current.srcObject = value; await video.current.play(); frame = requestAnimationFrame(loop);
    }).catch(() => { onError("Could not open the camera. Allow camera access or enter the code instead."); close(); });
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); };
  }, [close, onCode, onError]);
  return <div className="verify-scanner"><video ref={video} muted playsInline aria-label="Certificate QR scanner camera preview" /><span aria-hidden="true" /><button type="button" onClick={close}><X size={14} /> Stop scanning</button></div>;
}

export default function VerificationPortal({ initialCode = "", embedded = false }: { initialCode?: string; embedded?: boolean }) {
  const [code, setCode] = useState(initialCode), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerificationDetails | null>(null), [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false), attempt = useRef(0);
  const [scanning, setScanning] = useState(false);
  const canScan = useSyncExternalStore(noopSubscribe, scanSupported, () => false);
  const acceptScannedCode = (value: string) => { setCode(value); setScanning(false); void verifyCode(value); };
  async function verifyCode(rawCode: string) {
    const current = ++attempt.current, value = normalizeVerificationCode(rawCode);
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
  function verify(event: FormEvent) { event.preventDefault(); void verifyCode(code); }
  return <main className={`verify-page ${embedded ? "verify-embedded" : ""}`}>
    {!embedded && <nav className="verify-nav"><Link href="/" className="verify-brand">IB <span>smart campus</span> ✦</Link><Link href="/"><ArrowLeft size={15} />Back to campus</Link></nav>}
    <section className="verify-intro"><span className="verify-eyebrow"><ShieldCheck size={16} /> OFFICIAL CERTIFICATE VERIFICATION</span><h1>Achievements worth<br /><em>checking.</em></h1><p>A certificate tells a story. Confirm its issuance details with the unique code printed on it.</p></section>
    <section className="verify-card" aria-labelledby="verify-title"><div className="verify-card-head"><span className="verify-shield"><ShieldCheck size={26} /></span><div><h2 id="verify-title">Verify a certificate</h2><p>Available to every signed-in Smart Campus member.</p></div></div>
      <form onSubmit={verify}><label htmlFor="verification-code">Certificate verification code</label><div className="verify-input-row"><input id="verification-code" value={code} onChange={event => { ++attempt.current; setCode(event.target.value.toUpperCase()); setResult(null); setInvalid(false); setError(""); setBusy(false); }} placeholder="e.g. 7K3M9P2R8V4X" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={24} aria-describedby="verification-help" required />{canScan && <button className="verify-scan-button" type="button" onClick={() => setScanning(value => !value)}><ScanLine size={18} />{scanning ? "Close camera" : "Scan QR"}</button>}<button type="submit" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}{busy ? "Checking…" : "Verify code"}</button></div>{scanning && <CertificateQrScanner onCode={acceptScannedCode} close={() => setScanning(false)} onError={setError} />}<p id="verification-help" className="verify-help">Enter the 12-character code exactly as printed, or scan its QR code. Uppercase and lowercase both work.</p></form>
      <div aria-live="polite" aria-atomic="true">
        {result && <article className="verify-result"><div className="verify-authentic"><BadgeCheck size={25} /><div><strong>✅ Verified Authentic</strong><small>This code matches an active IB Smart Campus certificate.</small></div></div><dl><div><dt>Recipient</dt><dd>{result.recipientName}</dd></div><div><dt>Course / event</dt><dd>{result.courseName}</dd></div><div><dt>Issue date</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(result.issuedAt)}</dd></div><div><dt>Organizer / issuer</dt><dd>{result.issuerName}</dd></div></dl><footer>Verification code <code>{result.verificationCode}</code></footer><p className="verify-help">Compare these details with the certificate you received. A matching code confirms issuance; it does not detect changes made to a copied image.</p></article>}
        {invalid && <div className="verify-invalid"><CircleX size={24} /><div><strong>❌ Invalid or Not Found</strong><p>Check the printed code and try again. Preview exports, self-uploaded certificates and removed certificates cannot be verified here.</p></div></div>}
        {error && <div className="verify-error" role="alert">{error}</div>}
      </div>
    </section>
    <section className="verify-guidance"><div><span>01</span><h3>Find the code</h3><p>Look for the verification code printed on your certificate.</p></div><div><span>02</span><h3>Check the record</h3><p>Enter it above to retrieve the original issuance details.</p></div><div><span>03</span><h3>Compare the details</h3><p>Match the recipient, event, date and issuer against your copy.</p></div></section>
    {!embedded && <footer className="verify-footer"><span>IB Smart Campus · Recognition with a record.</span><a href="/certificates">Certificate portal ↗</a></footer>}
  </main>;
}
