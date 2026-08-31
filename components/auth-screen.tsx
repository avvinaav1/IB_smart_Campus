"use client";

import Image from "next/image";
import { ArrowLeft, ArrowRight, CheckCircle2, Gift, KeyRound, LoaderCircle, LockKeyhole, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";

type AuthIntent = "register" | "login";
type ApiResult = { error?: string; data?: Record<string, unknown>; meta?: { devCode?: string } };

async function postJson(url: string, body: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as ApiResult;
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [screen, setScreen] = useState<"welcome" | "form">("welcome");
  const [intent, setIntent] = useState<AuthIntent>("register");
  const [loginMethod, setLoginMethod] = useState<"otp" | "password">("otp");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  function switchIntent(next: AuthIntent) {
    if (busy) return;
    setIntent(next);
    setStep("email");
    setCode("");
    setPassword("");
    setReferralCode("");
    setDevCode("");
    setError("");
  }

  function openAuthentication(next: AuthIntent) {
    switchIntent(next);
    setScreen("form");
  }

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/api/auth/request-otp", { email, intent, ...(intent === "register" && referralCode.trim() ? { referralCode: referralCode.trim() } : {}) });
      setEmail(email.trim().toLowerCase());
      setDevCode(result.meta?.devCode || "");
      setStep("code");
      setCooldown(60);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 6) return setError("Enter the complete 6-digit code.");
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/api/auth/verify-otp", { email, code, intent });
      const user = result.data?.user as SessionUser | undefined;
      if (!user) throw new Error("The server did not return your account.");
      onAuthenticated(user);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  async function logInWithPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/api/auth/password-login", { email, password });
      const user = result.data?.user as SessionUser | undefined;
      if (!user) throw new Error("The server did not return your account.");
      onAuthenticated(user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  if (screen === "welcome") return <main className="auth-welcome">
    <header className="auth-welcome-mark" aria-label="IB Smart Campus">
      <span /><span /><span /><span /><span />
    </header>

    <section className="auth-orb-stage" aria-hidden="true">
      <span className="welcome-orb welcome-orb-back-one" />
      <span className="welcome-orb welcome-orb-back-two" />
      <span className="welcome-orb welcome-orb-left"><i>😎</i></span>
      <span className="welcome-orb welcome-orb-left-soft"><i>🔥</i></span>
      <span className="welcome-orb welcome-orb-right-soft"><i>🎭</i></span>
      <span className="welcome-orb welcome-orb-right"><i>😎</i></span>
      <span className="auth-orb-haze" />
      <span className="welcome-orb welcome-orb-center">
        <Image src="/smart-campus-logo-black.png" alt="" width={6103} height={6103} priority />
      </span>
    </section>

    <section className="auth-welcome-copy">
      <h1>Meet IB Smart<br />Campus.</h1>
      <p>The first intelligent, personal campus<br className="auth-copy-break" /> platform.</p>
    </section>

    <div className="auth-welcome-actions">
      <button type="button" className="auth-welcome-login" onClick={() => openAuthentication("login")}>
        <span><Image src="/smart-campus-logo-black.png" alt="" width={6103} height={6103} /></span>
        Login into account
      </button>
      <button type="button" className="auth-welcome-create" onClick={() => openAuthentication("register")}>Create an account</button>
    </div>
  </main>;

  return <main className="auth-shell">
    <section className="auth-story" aria-label="Smart Campus welcome">
      <div className="auth-brand"><span><Image src="/smart-campus-logo-white.png" alt="" width={1024} height={1024} priority /></span><b>smart</b>campus</div>
      <div className="auth-story-copy"><span className="eyebrow lime">YOUR PEOPLE ARE HERE</span><h1>Campus feels smaller when you&apos;re connected.</h1><p>Find communities, make plans, share the moments and never miss what&apos;s happening next.</p></div>
      <div className="auth-proof"><div><CheckCircle2 size={18} /><span><b>Password-free</b><small>One secure code. No password to remember.</small></span></div><div><ShieldCheck size={18} /><span><b>Campus-safe sessions</b><small>Your session can be revoked instantly.</small></span></div></div>
      <span className="auth-scribble" aria-hidden="true">〰 ✦ 〰</span>
    </section>

    <section className="auth-panel">
      <div className="auth-card">
        <button className="auth-choice-back" type="button" onClick={() => setScreen("welcome")}><ArrowLeft size={16} /> Back</button>
        <div className="auth-mobile-brand"><span><Image src="/smart-campus-logo-black.png" alt="" width={6103} height={6103} priority /></span><b>smart</b>campus</div>
        <div className="auth-tabs" aria-label="Authentication method">
          <button type="button" className={intent === "register" ? "active" : ""} onClick={() => switchIntent("register")}>Create account</button>
          <button type="button" className={intent === "login" ? "active" : ""} onClick={() => switchIntent("login")}>Log in</button>
        </div>

        {step === "email" ? <form onSubmit={intent === "login" && loginMethod === "password" ? logInWithPassword : requestCode}>
          <span className="auth-icon">{intent === "login" && loginMethod === "password" ? <KeyRound size={25} /> : <Mail size={25} />}</span>
          <h2>{intent === "register" ? "Join your campus" : "Welcome back"}</h2>
          <p>{intent === "register" ? "Start with your email. We’ll send a one-time code to verify it’s really you." : loginMethod === "password" ? "Use the password you created in Profile settings, or switch back to a one-time email code." : "Enter the email linked to your account and we’ll send a fresh login code."}</p>
          <label className="auth-field"><span>Email address</span><div><Mail size={18} /><input required autoFocus type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@university.edu" /></div></label>
          {intent === "register" && <label className="auth-field"><span>Referral code <small>(optional)</small></span><div><Gift size={18} /><input type="text" autoComplete="off" value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 15))} placeholder="SC-XXXXXXXX" /></div></label>}
          {intent === "login" && loginMethod === "password" && <label className="auth-field"><span>Password</span><div><KeyRound size={18} /><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></div></label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy || !email.trim() || (intent === "login" && loginMethod === "password" && !password)}>{busy ? <LoaderCircle className="spin" size={19} /> : intent === "login" && loginMethod === "password" ? <KeyRound size={18} /> : <Mail size={18} />}{busy ? loginMethod === "password" ? "Logging in…" : "Sending…" : intent === "login" && loginMethod === "password" ? "Log in with password" : "Email me a code"}<ArrowRight size={18} /></button>
          {intent === "login" && <button className="auth-method-switch" type="button" onClick={() => { setLoginMethod((method) => method === "otp" ? "password" : "otp"); setPassword(""); setError(""); }}>{loginMethod === "otp" ? <KeyRound size={15} /> : <Mail size={15} />}{loginMethod === "otp" ? "Use a password instead" : "Use an email code instead"}</button>}
          <small className="auth-terms"><LockKeyhole size={13} /> By continuing, you agree to keep Smart Campus safe and respectful.</small>
        </form> : <form onSubmit={verifyCode}>
          <button className="auth-back" type="button" onClick={() => { setStep("email"); setCode(""); setError(""); }}><ArrowLeft size={16} /> Change email</button>
          <span className="auth-icon"><ShieldCheck size={25} /></span>
          <h2>Check your inbox</h2>
          <p>We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.</p>
          <label className="auth-field auth-code-field"><span>Verification code</span><input required autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
          {devCode && <button className="dev-code" type="button" onClick={() => setCode(devCode)}><span><b>Local development code</b><small>Email delivery is not configured</small></span><strong>{devCode}</strong></button>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy || code.length !== 6}>{busy ? <LoaderCircle className="spin" size={19} /> : <ShieldCheck size={18} />}{busy ? "Verifying…" : intent === "register" ? "Verify & create account" : "Verify & log in"}<ArrowRight size={18} /></button>
          <button className="auth-resend" type="button" disabled={busy || cooldown > 0} onClick={() => requestCode()}><RefreshCw size={15} />{cooldown ? `Resend available in ${cooldown}s` : "Send a new code"}</button>
        </form>}
      </div>
      <p className="auth-security-note"><ShieldCheck size={15} /> Codes expire after 10 minutes · 5 verification attempts · 6 requests per 15 minutes</p>
    </section>
  </main>;
}

export function AuthLoading() {
  return <main className="auth-loading"><span><Image src="/smart-campus-logo-black.png" alt="Smart Campus" width={6103} height={6103} priority /></span><LoaderCircle className="spin" size={22} /><p>Opening your campus…</p></main>;
}
