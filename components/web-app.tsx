"use client";

import { BellRing, Check, Download, LoaderCircle, Share, Smartphone, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

/* Installable web app + push notifications.
 * `beforeinstallprompt` fires once, early, so it is captured at module load and shared through a tiny store. */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type PushState = "unsupported" | "unconfigured" | "off" | "on" | "blocked";

let installPrompt: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installed = true;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isStandalone() {
  return installed || window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

function base64UrlToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function api<T>(method: "GET" | "POST" | "DELETE", body?: unknown) {
  const response = await fetch("/api/push/subscription", { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(result.error || "Could not update push notifications.");
  return result.data as T;
}

/** Turns on push for this device. Must run from a click so the permission prompt is allowed. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const { publicKey } = await api<{ publicKey: string }>("GET");
  if (!publicKey) return "unconfigured";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const worker = await registration();
  await navigator.serviceWorker.ready;
  const existing = await worker.pushManager.getSubscription();
  const subscription = existing || await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  await api("POST", subscription.toJSON());
  return "on";
}

export async function disablePush() {
  if (!pushSupported()) return;
  const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (!subscription) return;
  await api("DELETE", { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

/** On log out: stop pushing this device to the departing user, but keep the browser subscription so the next sign-in re-links it. */
export async function unlinkPushDevice() {
  if (!pushSupported()) return;
  const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (subscription) await api("DELETE", { endpoint: subscription.endpoint }).catch(() => undefined);
}

async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

/** Registers the service worker and, for a signed-in user who already allowed push, re-links this device to them. */
export function WebAppBootstrap({ userId }: { userId: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    void (async () => {
      try {
        const worker = await registration();
        if (!userId || !pushSupported() || Notification.permission !== "granted") return;
        const subscription = await worker.pushManager.getSubscription();
        if (active && subscription) await api("POST", subscription.toJSON());
      } catch (error) {
        console.error("Service worker setup failed", error);
      }
    })();
    return () => { active = false; };
  }, [userId]);
  return null;
}

function useInstallState() {
  const canPrompt = useSyncExternalStore(subscribe, () => Boolean(installPrompt), () => false);
  const standalone = useSyncExternalStore(subscribe, isStandalone, () => false);
  const ios = useSyncExternalStore(subscribe, isIos, () => false);
  return { canPrompt, standalone, ios };
}

function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    let active = true;
    currentPushState().then((next) => { if (active) setState(next); }, () => { if (active) setState("unsupported"); });
    return () => { active = false; };
  }, []);
  return [state, setState] as const;
}

const pushMessages: Record<PushState, string> = {
  unsupported: "This browser can't receive push notifications",
  unconfigured: "Push notifications aren't set up on the server yet",
  off: "Get calls, invites and updates even when the app is closed",
  on: "On for this device",
  blocked: "Blocked — allow notifications for this site in your browser settings",
};

/** Shows the browser's install dialog; true when the user accepted. */
async function promptInstall() {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  emit();
  return outcome === "accepted";
}

/** Rows for the profile Preferences panel: install the app, and push notifications on/off. */
export function WebAppPreferences({ notify }: { notify: (message: string) => void }) {
  const { canPrompt, standalone, ios } = useInstallState();
  const [push, setPush] = usePushState();
  const [busy, setBusy] = useState(false);

  async function install() {
    if (await promptInstall()) notify("Installing IB Smart Campus…");
  }

  async function togglePush() {
    setBusy(true);
    try {
      if (push === "on") { await disablePush(); setPush("off"); notify("Push notifications turned off for this device"); }
      else {
        const next = await enablePush();
        setPush(next);
        notify(next === "on" ? "Push notifications are on" : pushMessages[next]);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not update push notifications.");
    } finally {
      setBusy(false);
    }
  }

  const iosNeedsInstall = ios && !standalone;
  return <>
    {!standalone && (canPrompt || ios) && <button type="button" onClick={() => canPrompt ? void install() : notify("In Safari, tap Share, then “Add to Home Screen”")}>
      {canPrompt ? <Download size={20} /> : <Smartphone size={20} />}<span><b>Install app</b><small>{canPrompt ? "Add IB Smart Campus to your home screen or desktop" : "Tap Share → Add to Home Screen in Safari"}</small></span>
    </button>}
    <button type="button" className="privacy-row" role="switch" aria-checked={push === "on"} disabled={busy || push === null || push === "unsupported" || push === "unconfigured" || (iosNeedsInstall && push !== "on")} onClick={() => void togglePush()}>
      {busy ? <LoaderCircle className="spin" size={20} /> : <BellRing size={20} />}<span><b>Push notifications</b><small>{iosNeedsInstall && push !== "on" ? "On iPhone, install the app first, then turn this on" : push ? pushMessages[push] : "Checking…"}</small></span><i className={push === "on" ? "on" : ""} />
    </button>
  </>;
}

/** One-line nudge at the top of the notifications drawer until push is on (or impossible) for this device. */
export function PushPromptBanner({ notify }: { notify: (message: string) => void }) {
  const [push, setPush] = usePushState();
  const [busy, setBusy] = useState(false);
  if (push !== "off") return null;
  return <div className="push-prompt"><BellRing size={16} /><span>Get notified even when the app is closed.</span><button type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try { const next = await enablePush(); setPush(next); notify(next === "on" ? "Push notifications are on" : pushMessages[next]); }
    catch (error) { notify(error instanceof Error ? error.message : "Could not turn on push notifications."); }
    finally { setBusy(false); }
  }}>{busy ? <LoaderCircle className="spin" size={14} /> : "Turn on"}</button></div>;
}

const ONBOARDING_SNOOZE_KEY = "smart-campus:web-app-prompt-snoozed-until";
const ONBOARDING_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
// Give `beforeinstallprompt` a moment to fire and the app a moment to settle before asking.
const ONBOARDING_DELAY_MS = 2_500;

function snoozed() {
  try { return Number(window.localStorage.getItem(ONBOARDING_SNOOZE_KEY) || 0) > Date.now(); } catch { return false; }
}

function snooze() {
  try { window.localStorage.setItem(ONBOARDING_SNOOZE_KEY, String(Date.now() + ONBOARDING_SNOOZE_MS)); } catch { /* storage unavailable */ }
}

/** Pop-up shown when someone opens IB Campus: install the app and turn on notifications, each one click.
 * Only appears when at least one of the two is still possible, and stays away for 3 days after "Not now". */
export function WebAppOnboarding({ notify }: { notify: (message: string) => void }) {
  const { canPrompt } = useInstallState();
  // Which steps to offer is decided once, when the pop-up opens, so finished steps stay visible as ticks.
  const [plan, setPlan] = useState<{ install: "prompt" | "ios" | null; push: PushState } | null>(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState<"install" | "push" | null>(null);
  const [installDone, setInstallDone] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (snoozed()) return;
      void currentPushState().catch(() => "unsupported" as const).then((push) => {
        if (!active) return;
        const standalone = isStandalone();
        const install = standalone ? null : installPrompt ? "prompt" : isIos() ? "ios" : null;
        // Only offer push when it can still be turned on (iPhone Safari reports "unsupported" until installed),
        // so a device that already has it on doesn't show a pre-ticked row.
        const offerPush: PushState = push === "off" ? "off" : "unsupported";
        if (install || offerPush === "off") setPlan({ install, push: offerPush });
      });
    }, ONBOARDING_DELAY_MS);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  if (!plan || closed) return null;
  const pushOn = plan.push === "on";
  const allDone = (!plan.install || installDone) && (plan.push !== "off" || pushOn);

  function dismiss() {
    if (!allDone) snooze();
    setClosed(true);
  }

  async function install() {
    setBusy("install");
    try { if (await promptInstall()) setInstallDone(true); }
    finally { setBusy(null); }
  }

  async function turnOnPush() {
    setBusy("push");
    try {
      const next = await enablePush();
      setPlan((current) => current && { ...current, push: next });
      if (next !== "on") notify(pushMessages[next]);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not turn on notifications.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="overlay web-app-onboarding-overlay" onMouseDown={(event) => event.target === event.currentTarget && dismiss()}>
    <section className="web-app-onboarding" role="dialog" aria-modal="true" aria-labelledby="web-app-onboarding-title">
      <button type="button" className="icon-button" aria-label="Close" onClick={dismiss}><X size={18} /></button>
      <span className="web-app-onboarding-icon"><Smartphone size={26} /></span>
      <h2 id="web-app-onboarding-title">Get the IB Campus app</h2>
      <p>Open IB Campus from your home screen and never miss a call, invite or event update.</p>
      <div className="web-app-onboarding-steps">
        {plan.install && <div className={installDone ? "done" : ""}>
          <span>{installDone ? <Check size={18} /> : <Download size={18} />}</span>
          <span><b>Install the app</b><small>{installDone ? "Installed — find it on your home screen" : plan.install === "prompt" ? "One tap, no app store needed" : <>Tap <Share size={11} aria-label="Share" /> Share, then “Add to Home Screen”</>}</small></span>
          {!installDone && plan.install === "prompt" && canPrompt && <button type="button" disabled={busy !== null} onClick={() => void install()}>{busy === "install" ? <LoaderCircle className="spin" size={15} /> : "Install"}</button>}
        </div>}
        {(plan.push === "off" || pushOn) && <div className={pushOn ? "done" : ""}>
          <span>{pushOn ? <Check size={18} /> : <BellRing size={18} />}</span>
          <span><b>Turn on notifications</b><small>{pushOn ? "You're all set on this device" : "Calls and updates, even when the app is closed"}</small></span>
          {!pushOn && <button type="button" disabled={busy !== null} onClick={() => void turnOnPush()}>{busy === "push" ? <LoaderCircle className="spin" size={15} /> : "Turn on"}</button>}
        </div>}
      </div>
      <footer><button type="button" className={allDone ? "web-app-onboarding-done" : "web-app-onboarding-later"} onClick={dismiss}>{allDone ? "Done" : "Not now"}</button></footer>
    </section>
  </div>;
}
