import "server-only";

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | undefined;
let cachedDb: Firestore | undefined;

function loadServiceAccount(): ServiceAccount {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const raw = inline || (file ? readFileSync(file, "utf8") : "");
  if (!raw) {
    throw new Error("Firebase is not configured. Set FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_SERVICE_ACCOUNT_PATH (path to the key file).");
  }
  const parsed = JSON.parse(raw) as Record<string, string>;
  // .env files store the PEM body with literal "\n"; the SDK needs real newlines.
  if (typeof parsed.private_key === "string") parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function firebaseApp(): App {
  if (cachedApp) return cachedApp;
  cachedApp = getApps()[0] ?? initializeApp({ credential: cert(loadServiceAccount()) });
  return cachedApp;
}

export function firestore(): Firestore {
  if (cachedDb) return cachedDb;
  const db = getFirestore(firebaseApp());
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if the instance was already used elsewhere; safe to skip.
  }
  cachedDb = db;
  return cachedDb;
}

const STORES_COLLECTION = process.env.FIRESTORE_STORES_COLLECTION || "smartCampusStores";

/**
 * Each domain store keeps its whole state as one JSON string inside a single
 * Firestore document (`<collection>/<name>`). Storing the serialised form keeps
 * us clear of Firestore's field-name rules (no dots in map keys) and matches the
 * load-all / mutate / save-all pattern the stores already use.
 *
 * Firestore caps a document at 1 MiB, so uploaded images are kept out of these
 * documents — see `lib/image-storage.ts`.
 *
 * Correctness note: every write goes through `mutateDocument`, which runs the
 * mutation inside a Firestore transaction (read-modify-write with automatic
 * retry on contention). A store must NOT hold its parsed state in module memory
 * across requests and overwrite the whole document from that snapshot — a second
 * process (extra `next dev`, a mid-request restart, a serverless instance) would
 * clobber concurrent writes, silently dropping freshly created sessions, posts,
 * memberships, etc. Reads may use the short per-process TTL cache below; writes
 * never may.
 */

const READ_TTL_MS = Math.max(0, Number(process.env.STORE_READ_TTL_MS ?? 3000));
type CacheEntry = { at: number; value: unknown };
const readCache = new Map<string, CacheEntry>();

function parseDocument<T>(snapshot: DocumentSnapshot): T | null {
  if (!snapshot.exists) return null;
  const raw = snapshot.get("json");
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function primeCache(name: string, value: unknown) {
  if (READ_TTL_MS > 0) readCache.set(name, { at: Date.now(), value });
}

/**
 * Read a store document. Served from a short per-process TTL cache unless
 * `fresh` is set. The cache only ever bounds cross-process staleness to
 * `STORE_READ_TTL_MS` (default 3s); it is refreshed on every successful write.
 */
export async function readDocument<T>(name: string, options?: { fresh?: boolean }): Promise<T | null> {
  if (!options?.fresh && READ_TTL_MS > 0) {
    const hit = readCache.get(name);
    if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value as T | null;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const snapshot = await firestore().collection(STORES_COLLECTION).doc(name).get();
      const value = parseDocument<T>(snapshot);
      primeCache(name, value);
      return value;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Overwrite a store document wholesale. Prefer `mutateDocument` — this is a
 * last-write-wins blind write, kept only for one-shot seeding/imports. */
export async function writeDocument(name: string, value: unknown): Promise<void> {
  await firestore().collection(STORES_COLLECTION).doc(name).set({ json: JSON.stringify(value), updatedAt: Date.now() });
  primeCache(name, value);
}

/**
 * Transactional read-modify-write of a store document. `mutator` receives the
 * currently persisted value (or null) and returns the next full value; it may be
 * invoked more than once if Firestore retries the transaction on contention, so
 * it must derive its result purely from the argument. The committed value is
 * returned and primed into the read cache.
 */
export async function mutateDocument<Current, Next>(
  name: string,
  mutator: (current: Current | null) => Next | Promise<Next>,
): Promise<Next> {
  const ref = firestore().collection(STORES_COLLECTION).doc(name);
  const committed = await firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const next = await mutator(parseDocument<Current>(snapshot));
    tx.set(ref, { json: JSON.stringify(next), updatedAt: Date.now() });
    return next;
  });
  primeCache(name, committed);
  return committed;
}
