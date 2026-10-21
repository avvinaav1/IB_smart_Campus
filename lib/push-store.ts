import "server-only";

import { createHash } from "node:crypto";
import webpush from "web-push";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import type { UserNotification } from "@/lib/types";

type StoredSubscription = {
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
};

type PushDatabase = { version: 1; subscriptions: Record<string, StoredSubscription> };

const STORE_DOC = process.env.PUSH_STORE_DOC || "push-subscriptions";
const MAX_SUBSCRIPTIONS_PER_USER = 10;
const SEND_TIMEOUT_MS = 5_000;
let writeQueue: Promise<unknown> = Promise.resolve();
let configured: boolean | null = null;

function hydrate(value: Partial<PushDatabase> | null): PushDatabase {
  return { version: 1, subscriptions: value?.subscriptions || {} };
}

function mutate<T>(action: (database: PushDatabase) => T): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<PushDatabase>, PushDatabase>(STORE_DOC, (current) => {
      const database = hydrate(current);
      result = action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

const subscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || "";
}

function ensureConfigured() {
  if (configured === null) {
    const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
    configured = Boolean(publicKey && privateKey);
    if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://ibcampus.icebrkr.space", publicKey!, privateKey!);
  }
  return configured;
}

export function validPushSubscription(value: unknown): value is { endpoint: string; keys: { p256dh: string; auth: string } } {
  const candidate = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!candidate || typeof candidate.endpoint !== "string" || candidate.endpoint.length > 1_000) return false;
  try { if (new URL(candidate.endpoint).protocol !== "https:") return false; } catch { return false; }
  return typeof candidate.keys?.p256dh === "string" && typeof candidate.keys.auth === "string" && candidate.keys.p256dh.length < 200 && candidate.keys.auth.length < 100;
}

export async function savePushSubscription(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return mutate((database) => {
    // A browser's endpoint belongs to whoever signed in on it most recently.
    database.subscriptions[subscriptionId(subscription.endpoint)] = { userId, endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, createdAt: Date.now() };
    const mine = Object.entries(database.subscriptions).filter(([, item]) => item.userId === userId).sort(([, a], [, b]) => b.createdAt - a.createdAt);
    for (const [id] of mine.slice(MAX_SUBSCRIPTIONS_PER_USER)) delete database.subscriptions[id];
    return { saved: true } as const;
  });
}

export async function removePushSubscription(userId: string, endpoint: string) {
  return mutate((database) => {
    const id = subscriptionId(endpoint);
    if (database.subscriptions[id]?.userId === userId) delete database.subscriptions[id];
    return { removed: true } as const;
  });
}

export async function deleteUserPushSubscriptions(userId: string) {
  return mutate((database) => {
    for (const [id, item] of Object.entries(database.subscriptions)) if (item.userId === userId) delete database.subscriptions[id];
    return { removed: true } as const;
  });
}

/** Pushes each notification to every device its recipient enabled. Never throws. */
export async function pushNotifications(notifications: UserNotification[]) {
  if (!notifications.length || !ensureConfigured()) return;
  try {
    const database = hydrate(await readDocument<Partial<PushDatabase>>(STORE_DOC));
    const byUser = new Map<string, [string, StoredSubscription][]>();
    for (const entry of Object.entries(database.subscriptions)) byUser.set(entry[1].userId, [...(byUser.get(entry[1].userId) || []), entry]);
    const expired: string[] = [];
    await Promise.allSettled(notifications.flatMap((notification) => (byUser.get(notification.recipientId) || []).map(async ([id, subscription]) => {
      const payload = JSON.stringify({ title: "IB Smart Campus", body: notification.content, url: notification.link, tag: notification.id });
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, { TTL: 60 * 60, timeout: SEND_TIMEOUT_MS, urgency: "high" });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(id);
        else console.error("Web push failed", status, error instanceof Error ? error.message : error);
      }
    })));
    if (expired.length) await mutate((current) => { for (const id of expired) delete current.subscriptions[id]; return null; });
  } catch (error) {
    console.error("Web push delivery failed", error);
  }
}
