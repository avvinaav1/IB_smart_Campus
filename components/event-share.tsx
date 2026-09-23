"use client";

import { Copy, Download, Facebook, Instagram, Linkedin, Mail, MessageCircle, Send, Share2, Twitter, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { eventSharePath, eventShareText, eventWhen } from "@/lib/event-format";
import { SITE_URL } from "@/lib/site";
import type { CampusEvent } from "@/lib/types";

const noopSubscribe = () => () => {};
// Mobile share sheets (Android/iOS) can attach the banner image itself.
const fileShareSupported = () => {
  try { return typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([""], "banner.jpg", { type: "image/jpeg" })] }); }
  catch { return false; }
};

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** "Share" button + menu that posts an event, with its full details and banner, to social apps. */
export function EventShare({ event, notify }: { event: CampusEvent; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const canShareFiles = useSyncExternalStore(noopSubscribe, fileShareSupported, () => false);
  // Always the production link, so previews work even when shared from dev.
  const url = `${SITE_URL}${eventSharePath(event.id)}`;
  const bannerPath = `${eventSharePath(event.id)}/banner`;
  const details = eventShareText(event, url);
  const popup = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  // Facebook and LinkedIn only take a link (their preview card shows the
  // banner, date and venue), so the text is copied for the user to paste.
  async function linkOnly(platform: string, href: string) {
    const copied = await copy(details);
    popup(href);
    notify(copied ? `Event details copied — paste them into your ${platform} post` : `Opening ${platform}…`);
  }

  async function shareWithBanner() {
    if (preparing) return;
    setPreparing(true);
    try {
      const response = await fetch(bannerPath);
      if (!response.ok) throw new Error("banner");
      const file = new File([await response.blob()], `${event.title.replace(/[^\w-]+/g, "-").slice(0, 40) || "event"}.jpg`, { type: "image/jpeg" });
      await navigator.share({ files: [file], title: event.title, text: details });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      // No banner (or the app refused the file): fall back to text + link.
      try { await navigator.share({ title: event.title, text: eventShareText(event, ""), url }); }
      catch (fallbackError) { if (!(fallbackError instanceof DOMException && fallbackError.name === "AbortError")) notify("Could not open the share sheet."); }
    } finally { setPreparing(false); }
  }

  async function instagram() {
    if (canShareFiles) return void shareWithBanner();
    // Instagram has no web share link: hand over the banner and caption instead.
    const link = document.createElement("a");
    link.href = bannerPath; link.download = "event-banner.jpg"; link.click();
    notify(await copy(details) ? "Banner downloaded and caption copied — post them on Instagram" : "Banner downloaded — post it on Instagram");
  }

  const targets: Array<{ label: string; icon: React.ReactNode; onClick: () => void }> = [
    { label: "WhatsApp", icon: <MessageCircle size={17} />, onClick: () => popup(`https://api.whatsapp.com/send?text=${encodeURIComponent(details)}`) },
    { label: "X", icon: <Twitter size={17} />, onClick: () => popup(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${event.title} · ${eventWhen(event)} IST · ${event.venueName}`)}&url=${encodeURIComponent(url)}`) },
    { label: "Facebook", icon: <Facebook size={17} />, onClick: () => void linkOnly("Facebook", `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`) },
    { label: "LinkedIn", icon: <Linkedin size={17} />, onClick: () => void linkOnly("LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`) },
    { label: "Telegram", icon: <Send size={17} />, onClick: () => popup(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(eventShareText(event, ""))}`) },
    { label: "Instagram", icon: <Instagram size={17} />, onClick: () => void instagram() },
    { label: "Email", icon: <Mail size={17} />, onClick: () => { window.location.href = `mailto:?subject=${encodeURIComponent(event.title)}&body=${encodeURIComponent(details)}`; } },
    { label: "Copy details", icon: <Copy size={17} />, onClick: async () => notify(await copy(details) ? "Event details and link copied" : "Could not copy — your browser blocked clipboard access") },
  ];

  return <div className="event-share">
    <button type="button" className="event-share-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><Share2 size={16} /> Share event</button>
    {open && <section className="event-share-panel" aria-label="Share this event">
      <header><b>Share this event</b><button type="button" onClick={() => setOpen(false)} aria-label="Close share options"><X size={15} /></button></header>
      <div className="event-share-preview">
        <pre>{details}</pre>
      </div>
      <div className="event-share-targets">
        {targets.map(target => <button type="button" key={target.label} onClick={target.onClick}>{target.icon} {target.label}</button>)}
        <a href={bannerPath} download="event-banner.jpg"><Download size={17} /> Download banner</a>
      </div>
      <p className="event-share-note">Links show the event banner, date and venue as a preview card.</p>
    </section>}
  </div>;
}
