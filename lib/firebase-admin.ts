import "server-only";

import { readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

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
 */
export async function readDocument<T>(name: string): Promise<T | null> {
  const snapshot = await firestore().collection(STORES_COLLECTION).doc(name).get();
  if (!snapshot.exists) return null;
  const raw = snapshot.get("json");
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeDocument(name: string, value: unknown): Promise<void> {
  await firestore().collection(STORES_COLLECTION).doc(name).set({ json: JSON.stringify(value), updatedAt: Date.now() });
}
