"use client";

import { useEffect, useRef, useState } from "react";
import { Award, LoaderCircle, ShieldCheck } from "lucide-react";
import CertificateBuilder from "./certificate-builder";
import VerificationPortal from "./verification-portal";
import { CertificateGallery } from "./certificate-gallery";
import { certificateRequest } from "./client";
import type { AppRole, CampusEvent } from "@/lib/types";

export default function CertificatePortal({ events, appRole, userId, preview = false, initialCode = "" }: { events: CampusEvent[]; appRole: AppRole; userId: string; preview?: boolean; initialCode?: string }) {
  const globalManager = appRole === "SUPER_ADMIN" || appRole === "APP_MODERATOR";
  const [canManage, setCanManage] = useState<boolean | undefined>(preview ? false : undefined);
  const [mode, setMode] = useState<"mine" | "manage" | "verify">(globalManager && !initialCode ? "manage" : initialCode ? "verify" : "mine");
  const selected = useRef(Boolean(initialCode));
  useEffect(() => {
    if (preview) return;
    let active = true;
    certificateRequest<{ canManage: boolean }>("/access").then(data => {
      if (!active) return;
      setCanManage(data.canManage);
      if (data.canManage && !selected.current) setMode("manage");
    }).catch(() => { if (active) setCanManage(false); });
    return () => { active = false; };
  }, [preview]);
  function choose(next: "mine" | "manage" | "verify") { selected.current = true; setMode(next); }
  if (canManage === undefined) return <section className="certificate-access-loading"><LoaderCircle className="spin" size={22} /> Loading certificate access…</section>;
  return <section className="certificate-portal-shell">
    <nav className="certificate-portal-tabs" aria-label="Certificate portal">
      <button className={mode === "mine" ? "active" : ""} onClick={() => choose("mine")}><Award size={17} /> My certificates</button>
      {canManage && <button className={mode === "manage" ? "active" : ""} onClick={() => choose("manage")}><Award size={17} /> Certificate management</button>}
      <button className={mode === "verify" ? "active" : ""} onClick={() => choose("verify")}><ShieldCheck size={17} /> Verify certificate</button>
    </nav>
    {mode === "manage" && canManage ? <CertificateBuilder preview={preview} events={events} /> : mode === "verify" ? <VerificationPortal initialCode={initialCode} embedded /> : <CertificateGallery userId={userId} preview={preview} canManage={globalManager} onBuild={canManage ? () => choose("manage") : undefined} />}
  </section>;
}
