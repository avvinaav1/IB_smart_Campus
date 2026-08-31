"use client";

import Image from "next/image";
import { CircleUserRound, ImageIcon, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/types";

type ApiResult = { data?: { user?: SessionUser }; error?: string };

async function parseResponse(response: Response) {
  const result = await response.json() as ApiResult;
  if (!response.ok) throw new Error(result.error || "Could not finish your profile.");
  return result.data?.user;
}

export function ProfileSetup({ user, onComplete }: { user: SessionUser; onComplete: (user: SessionUser) => void }) {
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function chooseAvatar(file?: File) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png"]).has(file.type)) return setError("Choose a PNG or JPEG image.");
    if (file.size > 5 * 1024 * 1024) return setError("Your photo must be 5 MB or smaller.");
    if (preview) URL.revokeObjectURL(preview);
    setAvatar(file);
    setPreview(URL.createObjectURL(file));
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let updated = user;
      if (avatar) {
        const form = new FormData();
        form.set("avatar", avatar);
        updated = await parseResponse(await fetch("/api/profile/avatar", { method: "POST", body: form })) || updated;
      }
      const completed = await parseResponse(await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), about: updated.about, campus: updated.campus }),
      }));
      if (!completed) throw new Error("The server did not return your completed profile.");
      onComplete(completed);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Could not finish your profile.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="profile-setup-shell">
    <form className="profile-setup-card" onSubmit={submit} aria-label="Set up your profile">
      <div className="profile-setup-hero" role="img" aria-label="A student beginning their Smart Campus journey" style={{ backgroundImage: "url(/profile-setup-hero.jpg)" }} />
      <section className="profile-setup-content">
        <header><h1>Welcome to IB Smart Campus,<br />Your first journey here!</h1><p>Add your Photo and Pick a username</p></header>
        <label className="profile-photo-picker">
          <span className="profile-photo-preview">{preview || user.avatarUrl ? <Image src={preview || user.avatarUrl} alt="Profile picture preview" fill sizes="52px" unoptimized /> : <CircleUserRound size={24} strokeWidth={1.35} />}</span>
          <span className="profile-photo-copy"><b>Your Photo</b><small>PNG or JPEG<br />upto 5MB<br />(500×500px)</small></span>
          <button type="button" onClick={() => fileInput.current?.click()}><ImageIcon size={17} />{avatar ? "Change" : "Upload"}</button>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
        </label>
        <label className="profile-setup-name"><span>Display Name</span><div><b>@</b><input required autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24)); setError(""); }} minLength={3} maxLength={24} placeholder="username" /></div></label>
        {error && <p className="profile-setup-error" role="alert">{error}</p>}
        <button className="profile-setup-continue" disabled={busy || username.trim().length < 3}>{busy ? <><LoaderCircle className="spin" size={19} /> Saving…</> : "Continue"}</button>
      </section>
    </form>
  </main>;
}
