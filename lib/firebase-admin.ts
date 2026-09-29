import "server-only";

import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | undefined;
let cachedDb: Firestore | undefined;
const localWrites = new Map<string, Promise<unknown>>();
function localStoreEnabled() { return process.env.NODE_ENV === "development" && process.env.LOCAL_DATA_STORE === "true"; }
function localPath(name: string) { return resolve(process.cwd(), ".local-data", `${createHash("sha256").update(name).digest("hex")}.json`); }
async function readLocal<T>(name: string): Promise<T | null> {
  try { return JSON.parse(await readFile(localPath(name), "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function writeLocal(name: string, value: unknown) {
  const file = localPath(name), temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(resolve(process.cwd(), ".local-data"), { recursive: true });
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}
function serializeLocal<T>(name: string, action: () => Promise<T>): Promise<T> {
  const current = (localWrites.get(name) || Promise.resolve()).then(action, action);
  localWrites.set(name, current.then(() => undefined, () => undefined));
  return current;
}

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
 * memberships, etc. Reads may use the version-validated cache below; writes
 * never may.
 *
 * Read-quota note: every store write also stamps a fresh version token into one
 * shared `_versions` document (inside the same transaction). A process keeps
 * each store's raw JSON in memory with the version it was read at, and only
 * re-reads a store when `_versions` says it changed. So an idle poll costs at
 * most ONE Firestore read per `STORE_READ_TTL_MS` window per process (the
 * `_versions` check), shared by every request and every store, instead of one
 * read per store per request.
 */

// How often a process re-checks `_versions`; bounds cross-process staleness.
const VERSION_TTL_MS = Math.max(0, Number(process.env.STORE_READ_TTL_MS ?? 5000));
// Safety net for out-of-band edits (e.g. the Firebase console) that don't bump
// `_versions`: a cached store is re-read at least this often.
const MAX_CACHE_AGE_MS = Math.max(0, Number(process.env.STORE_CACHE_MAX_AGE_MS ?? 10 * 60_000));
const VERSIONS_DOC = "_versions";

type Versions = Record<string, string>;
type CacheEntry = { fetchedAt: number; updatedAt: number; version?: string; raw: string | null };
const storeCache = new Map<string, CacheEntry>();
const storeReads = new Map<string, Promise<CacheEntry>>();
let versionsCache: { at: number; value: Versions } | undefined;
let versionsRead: Promise<Versions> | undefined;

function newVersion() { return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`; }

function parseRaw<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    // Parse per call: callers get their own object, so mutating a read result
    // can never corrupt the shared cache.
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseDocument<T>(snapshot: DocumentSnapshot): T | null {
  return parseRaw<T>(snapshot.exists ? rawOf(snapshot) : null);
}

function rawOf(snapshot: DocumentSnapshot) {
  const raw = snapshot.get("json");
  return typeof raw === "string" && raw ? raw : null;
}

function cacheEntry(name: string, entry: CacheEntry) {
  const existing = storeCache.get(name);
  // A slow read that started before a local write must not overwrite the newer committed value.
  if (existing && existing.updatedAt > entry.updatedAt) { existing.fetchedAt = Math.max(existing.fetchedAt, entry.fetchedAt); return existing; }
  storeCache.set(name, entry);
  return entry;
}

async function withRetry<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { return action(); }
}

let forcedRead: { started: boolean; promise: Promise<Versions> } | undefined;

function readVersions(): Promise<Versions> {
  return withRetry(async () => {
    const at = Date.now();
    const snapshot = await firestore().collection(STORES_COLLECTION).doc(VERSIONS_DOC).get();
    const value = { ...(snapshot.data() || {}) } as Versions;
    if (!versionsCache || at >= versionsCache.at) versionsCache = { at, value };
    return value;
  });
}

function loadVersions(force = false): Promise<Versions> {
  if (force) {
    // A `fresh` caller needs a read that starts after it was called. Callers
    // arriving in the same tick, before that read starts, safely share it.
    if (forcedRead && !forcedRead.started) return forcedRead.promise;
    const pending: { started: boolean; promise: Promise<Versions> } = { started: false, promise: Promise.resolve({}) };
    pending.promise = Promise.resolve().then(() => { pending.started = true; return readVersions(); });
    forcedRead = pending;
    return pending.promise;
  }
  if (versionsCache && Date.now() - versionsCache.at < VERSION_TTL_MS) return Promise.resolve(versionsCache.value);
  if (!versionsRead) {
    const read = readVersions();
    versionsRead = read;
    void read.finally(() => { if (versionsRead === read) versionsRead = undefined; }).catch(() => undefined);
  }
  return versionsRead;
}

function fetchStore(name: string, force = false): Promise<CacheEntry> {
  const inflight = storeReads.get(name);
  if (inflight && !force) return inflight;
  const read = withRetry(async () => {
    const fetchedAt = Date.now();
    const snapshot = await firestore().collection(STORES_COLLECTION).doc(name).get();
    const version = snapshot.get("version");
    return cacheEntry(name, {
      fetchedAt,
      updatedAt: Number(snapshot.get("updatedAt")) || 0,
      version: typeof version === "string" ? version : undefined,
      raw: snapshot.exists ? rawOf(snapshot) : null,
    });
  });
  if (force) return read;
  storeReads.set(name, read);
  void read.finally(() => { if (storeReads.get(name) === read) storeReads.delete(name); }).catch(() => undefined);
  return read;
}

function recordWrite(name: string, raw: string, version: string, updatedAt: number) {
  cacheEntry(name, { fetchedAt: Date.now(), updatedAt, version, raw });
  if (versionsCache) versionsCache.value = { ...versionsCache.value, [name]: version };
}

/**
 * Read a store document from the version-validated cache. The store is only
 * fetched from Firestore when `_versions` shows it changed (or it isn't cached
 * yet). `fresh` forces the `_versions` check to hit Firestore now instead of
 * using the last check — still one read, and no store read if nothing changed.
 */
export async function readDocument<T>(name: string, options?: { fresh?: boolean }): Promise<T | null> {
  if (localStoreEnabled()) return readLocal<T>(name);
  if (VERSION_TTL_MS === 0) return parseRaw<T>((await fetchStore(name, true)).raw);
  const versions = await loadVersions(options?.fresh);
  const hit = storeCache.get(name);
  const known = versions[name];
  if (hit && Date.now() - hit.fetchedAt < MAX_CACHE_AGE_MS) {
    // Stores last written before `_versions` existed have no token yet; fall
    // back to plain TTL caching for them until their next write.
    if (known ? hit.version === known : !options?.fresh && Date.now() - hit.fetchedAt < VERSION_TTL_MS) return parseRaw<T>(hit.raw);
  }
  return parseRaw<T>((await fetchStore(name, options?.fresh)).raw);
}

/** Overwrite a store document wholesale. Prefer `mutateDocument` — this is a
 * last-write-wins blind write, kept only for one-shot seeding/imports. */
export async function writeDocument(name: string, value: unknown): Promise<void> {
  if (localStoreEnabled()) { await serializeLocal(name, () => writeLocal(name, value)); return; }
  const raw = JSON.stringify(value), version = newVersion(), updatedAt = Date.now();
  const collection = firestore().collection(STORES_COLLECTION);
  const batch = firestore().batch();
  batch.set(collection.doc(name), { json: raw, updatedAt, version });
  batch.set(collection.doc(VERSIONS_DOC), { [name]: version }, { merge: true });
  await batch.commit();
  recordWrite(name, raw, version, updatedAt);
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
  if (localStoreEnabled()) return serializeLocal(name, async () => { const next = await mutator(await readLocal<Current>(name)); await writeLocal(name, next); return next; });
  const collection = firestore().collection(STORES_COLLECTION);
  const ref = collection.doc(name);
  const committed = await firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const next = await mutator(parseDocument<Current>(snapshot));
    const raw = JSON.stringify(next), version = newVersion(), updatedAt = Date.now();
    tx.set(ref, { json: raw, updatedAt, version });
    // Blind merge (never read in the txn), so writes to different stores don't contend on it.
    tx.set(collection.doc(VERSIONS_DOC), { [name]: version }, { merge: true });
    return { next, raw, version, updatedAt };
  });
  recordWrite(name, committed.raw, committed.version, committed.updatedAt);
  return committed.next;
}
