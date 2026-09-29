"use client";

const EVENT_NAME = "smart-campus:data-changed";
const CHANNEL_NAME = "smart-campus-data-sync";

function receive() {
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function announceDataChange() {
  if (typeof window === "undefined") return;
  receive();
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ changedAt: Date.now() });
    channel.close();
  } catch { /* BroadcastChannel is optional; the current tab still refreshes. */ }
}

export function subscribeToDataChanges(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT_NAME, listener);
  let channel: BroadcastChannel | null = null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); channel.addEventListener("message", listener); } catch { channel = null; }
  return () => { window.removeEventListener(EVENT_NAME, listener); channel?.removeEventListener("message", listener); channel?.close(); };
}

export function mutationSucceeded(init?: RequestInit) {
  return Boolean(init?.method && !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase()));
}

/**
 * Calls `refresh` every `intervalMs` while the tab is visible — a hidden tab
 * makes no requests — and immediately when the tab is focused/shown again, so
 * returning users still see current data. Returns the cleanup function.
 */
export function pollWhileVisible(refresh: () => void, intervalMs: number) {
  let lastRun = Date.now();
  const run = () => { lastRun = Date.now(); refresh(); };
  const tick = () => { if (!document.hidden) run(); };
  // focus and visibilitychange usually fire together on tab switch; refresh once.
  const resume = () => { if (!document.hidden && Date.now() - lastRun > 1_000) run(); };
  const interval = window.setInterval(tick, intervalMs);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
