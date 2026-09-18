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
