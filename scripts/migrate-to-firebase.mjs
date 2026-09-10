// One-time migration of the local .data/*.json stores into Firestore.
//
// Usage (Node 20.6+ loads the env file itself):
//   node --env-file=.env.local scripts/migrate-to-firebase.mjs
//
// Safe to re-run: each store document is overwritten with the local file's
// contents. Stores with no local file are skipped (they seed themselves on
// first read). The campus directory stays a bundled file and is not migrated.

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const COLLECTION = process.env.FIRESTORE_STORES_COLLECTION || "smartCampusStores";
const STORES = [
  { file: ".data/auth.json", doc: process.env.AUTH_STORE_DOC || "auth" },
  { file: ".data/communities.json", doc: process.env.COMMUNITIES_STORE_DOC || "communities" },
  { file: ".data/events.json", doc: process.env.EVENTS_STORE_DOC || "events" },
  { file: ".data/posts.json", doc: process.env.POSTS_STORE_DOC || "posts" },
  { file: ".data/social.json", doc: process.env.SOCIAL_STORE_DOC || "social" },
];

function loadServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  const raw = inline || (file ? readFileSync(file, "utf8") : "");
  if (!raw) throw new Error("Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH.");
  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === "string") parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
}

const app = getApps()[0] ?? initializeApp({ credential: cert(loadServiceAccount()) });
const db = getFirestore(app);

for (const { file, doc } of STORES) {
  let raw;
  try {
    raw = await readFile(path.join(process.cwd(), file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`skip  ${file} (not present)`);
      continue;
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  await db.collection(COLLECTION).doc(doc).set({ json: JSON.stringify(parsed), updatedAt: Date.now() });
  console.log(`wrote ${file} -> ${COLLECTION}/${doc}`);
}

console.log("Migration complete.");
process.exit(0);
