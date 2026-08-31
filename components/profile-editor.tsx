"use client";

import Image from "next/image";
import { Camera, Check, KeyRound, LoaderCircle, Mail, Save, ShieldCheck, UserRound, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { CampusPicker } from "@/components/campus-picker";
import type { SessionUser } from "@/lib/types";

type Tab = "profile" | "password" | "email";
type ApiResult = { error?: string; data?: { user?: SessionUser }; meta?: { devCode?: string } };

async function parseResponse(response: Response) {
  const result = await response.json() as ApiResult;
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

async function postJson(url: string, body: object, method = "POST") {
  return parseResponse(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

export function ProfileEditor({ user, close, onUpdated, notify }: { user: SessionUser; close: () => void; onUpdated: (user: SessionUser) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [username, setUsername] = useState(user.username);
  const [about, setAbout] = useState(user.about);
  const [campus, setCampus] = useState(user.campus);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailStep, setEmailStep] = useState<"request" | "verify">("request");
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  function selectAvatar(file?: File) {
    setError("");
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) return setError("Choose a JPG or PNG image.");
    if (file.size > 5 * 1024 * 1024) return setError("Profile picture must be 5 MB or smaller.");
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatar(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let updated = (await postJson("/api/profile", { username, about, campus }, "PATCH")).data?.user;
      if (avatar) {
        const form = new FormData();
        form.set("avatar", avatar);
        updated = (await parseResponse(await fetch("/api/profile/avatar", { method: "POST", body: form }))).data?.user;
      }
      if (!updated) throw new Error("The server did not return your updated profile.");
      onUpdated(updated);
      notify("Profile updated");
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setError("New passwords do not match.");
    setBusy(true);
    setError("");
    try {
      const updated = (await postJson("/api/profile/password", { currentPassword, newPassword })).data?.user;
      if (!updated) throw new Error("The server did not return your updated account.");
      onUpdated(updated);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify(user.hasPassword ? "Password updated" : "Password created");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  async function requestEmailCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await postJson("/api/profile/email/request-otp", { newEmail });
      setNewEmail(newEmail.trim().toLowerCase());
      setDevCode(result.meta?.devCode || "");
      setEmailStep("verify");
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Could not send the verification code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = (await postJson("/api/profile/email/verify-otp", { newEmail, code: emailCode })).data?.user;
      if (!updated) throw new Error("The server did not return your updated account.");
      onUpdated(updated);
      setEmailStep("request");
      setNewEmail("");
      setEmailCode("");
      setDevCode("");
      notify("Email verified and updated");
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Could not verify the new email.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="overlay profile-editor-overlay" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
      <header><div><span className="eyebrow violet">YOUR ACCOUNT</span><h2 id="profile-editor-title">Edit profile</h2><p>Account ID · {user.id}</p></div><button className="icon-button" onClick={close} aria-label="Close profile editor"><X size={20} /></button></header>
      <nav aria-label="Profile settings"><button className={tab === "profile" ? "active" : ""} onClick={() => { setTab("profile"); setError(""); }}><UserRound size={17} />Profile</button><button className={tab === "password" ? "active" : ""} onClick={() => { setTab("password"); setError(""); }}><KeyRound size={17} />Password</button><button className={tab === "email" ? "active" : ""} onClick={() => { setTab("email"); setError(""); }}><Mail size={17} />Email</button></nav>

      {tab === "profile" && <form onSubmit={saveProfile}>
        <label className="avatar-editor"><span>{avatarPreview || user.avatarUrl ? <Image src={avatarPreview || user.avatarUrl} alt="Profile preview" fill sizes="96px" unoptimized /> : user.username.slice(0, 2).toUpperCase()}</span><div><b>Profile picture</b><small>JPG or PNG · maximum 5 MB</small><em><Camera size={15} /> Choose image<input type="file" accept="image/jpeg,image/png" onChange={(event) => selectAvatar(event.target.files?.[0])} /></em></div></label>
        <label className="field"><span>Username</span><input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} /><small>Unique · 3–24 letters, numbers, or underscores</small></label>
        <CampusPicker value={campus} onChange={setCampus} label="College campus" />
        <label className="field"><span>About</span><textarea rows={5} maxLength={500} value={about} onChange={(event) => setAbout(event.target.value)} placeholder="Tell campus what you’re into…" /><small>{about.length} / 500</small></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" className="draft-button" onClick={close}>Cancel</button><button className="primary-action" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}Save profile</button></footer>
      </form>}

      {tab === "password" && <form onSubmit={savePassword}>
        <div className="settings-intro"><span><KeyRound size={23} /></span><div><h3>{user.hasPassword ? "Change your password" : "Create a password"}</h3><p>{user.hasPassword ? "Confirm your current password before choosing a new one." : "Add password login as an alternative to email codes."}</p></div></div>
        {user.hasPassword && <label className="field"><span>Current password</span><input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>}
        <label className="field"><span>New password</span><input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>8+ characters with at least one letter and one number</small></label>
        <label className="field"><span>Confirm new password</span><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button className="primary-action" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}{user.hasPassword ? "Update password" : "Create password"}</button></footer>
      </form>}

      {tab === "email" && (emailStep === "request" ? <form onSubmit={requestEmailCode}>
        <div className="settings-intro"><span><Mail size={23} /></span><div><h3>Change account email</h3><p>Your current email is <b>{user.email}</b>. We’ll verify the new address before changing anything.</p></div></div>
        <label className="field"><span>New email address</span><input required type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="new@university.edu" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button className="primary-action" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />}Send verification code</button></footer>
      </form> : <form onSubmit={verifyEmail}>
        <div className="settings-intro"><span><ShieldCheck size={23} /></span><div><h3>Verify the new email</h3><p>Enter the code sent to <b>{newEmail}</b>. Your current email remains active until verification succeeds.</p></div></div>
        <label className="field editor-code"><span>6-digit code</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>
        {devCode && <button className="dev-code" type="button" onClick={() => setEmailCode(devCode)}><span><b>Local development code</b><small>Email delivery is not configured</small></span><strong>{devCode}</strong></button>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer><button type="button" className="draft-button" onClick={() => { setEmailStep("request"); setEmailCode(""); setError(""); }}>Back</button><button className="primary-action" disabled={busy || emailCode.length !== 6}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Verify & update</button></footer>
      </form>)}
    </section>
  </div>;
}
