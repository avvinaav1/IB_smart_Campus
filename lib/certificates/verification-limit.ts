import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { Firestore } from "firebase-admin/firestore";

const WINDOW = 60_000;
export function verificationClientKey(headers: Headers) {
  // Trust only a header explicitly configured for a gateway that overwrites
  // it. Without that deployment contract, all callers share a conservative bucket.
  const header = process.env.CERTIFICATE_CLIENT_IP_HEADER;
  const address = header ? headers.get(header)?.trim() : undefined;
  return address && isIP(address) ? createHash("sha256").update(address).digest("hex") : "shared";
}
export function nextVerificationQuota(previous: { start: number; count: number } | undefined, limit: number, now: number) {
  const state = previous && previous.start <= now && now - previous.start < WINDOW ? previous : { start: now, count: 0 };
  return { allowed: state.count < limit, next: { start: state.start, count: state.count + 1 }, retryAfter: Math.max(1, Math.ceil((state.start + WINDOW - now) / 1000)) };
}
// Fixed bucket IDs and expiresAt TTL avoid accumulating window documents. Transactions enforce the
// same quota across server instances/restarts, including concurrent requests.
export async function verificationQuota(db: Firestore, clientKey: string) {
  const global = db.collection("certificateVerificationLimits").doc("global");
  const client = db.collection("certificateVerificationLimits").doc(`client-${clientKey}`);
  return db.runTransaction(async tx => {
    const [all, single] = await Promise.all([tx.get(global), tx.get(client)]);
    const now = Date.now();
    const a = nextVerificationQuota(all.data() as { start: number; count: number } | undefined, 300, now);
    const b = nextVerificationQuota(single.data() as { start: number; count: number } | undefined, 20, now);
    if (!a.allowed || !b.allowed) return { allowed: false, retryAfter: Math.max(!a.allowed ? a.retryAfter : 0, !b.allowed ? b.retryAfter : 0) };
    tx.set(global, { ...a.next, expiresAt: new Date(now + 86_400_000) });
    tx.set(client, { ...b.next, expiresAt: new Date(now + 86_400_000) });
    return { allowed: true, retryAfter: 0 };
  });
}
