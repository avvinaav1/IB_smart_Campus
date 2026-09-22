import "server-only";
import { firestore } from "@/lib/firebase-admin";
import { hashId } from "./store";
import type { JobRecord, JobRow } from "./model";

// Certificate emails no longer attach the PNG (see certificateMail). Instead,
// any row that was emailed to an address without a matching account at send
// time gets a pending claim record here, keyed by (jobId, rowId) so retries
// don't duplicate it. When someone later registers or signs in with that same
// email, claimPendingCertificates() awards it to their account — identical to
// internalAward(), minus the live job-lease requirement (the job is long done
// by then).
const claims = () => firestore().collection("certificateClaims");

function localDataStoreEnabled() {
  return process.env.NODE_ENV === "development" && process.env.LOCAL_DATA_STORE === "true";
}

export async function recordPendingClaim(job: Pick<JobRecord, "id" | "title" | "organizerId" | "issuerName" | "eventId">, row: Pick<JobRow, "id" | "assetId" | "emailNormalized" | "verificationCode">) {
  if (localDataStoreEnabled() || !row.emailNormalized || !row.assetId) return;
  const id = hashId("claim", job.id, row.id);
  await claims().doc(id).set({
    schemaVersion: 1, email: row.emailNormalized, jobId: job.id, rowId: row.id,
    assetId: row.assetId, title: job.title, issuerId: job.organizerId, issuerName: job.issuerName,
    ...(job.eventId ? { eventId: job.eventId } : {}),
    ...(row.verificationCode ? { verificationCode: row.verificationCode } : {}),
    claimed: false, createdAt: Date.now(),
  }, { merge: true });
}

// Best-effort: called right after a session is created (registration or OTP
// login). Never throws — a claim lookup failure must not block sign-in.
export async function claimCertificatesBestEffort(userId: string, email: string) {
  if (localDataStoreEnabled()) return;
  try { await claimPendingCertificates(userId, email); }
  catch (error) { console.error("Certificate claim lookup failed", { code: (error as NodeJS.ErrnoException).code || "unavailable" }); }
}

export async function claimPendingCertificates(userId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  const db = firestore();
  const pending = await claims().where("email", "==", normalized).where("claimed", "==", false).limit(50).get();
  let awarded = 0;
  for (const doc of pending.docs) {
    const data = doc.data() as { jobId: string; rowId: string; assetId: string; title: string; issuerId: string; issuerName: string; eventId?: string };
    const certificateId = hashId("claim-cert", doc.id, userId);
    const certRef = db.collection("certificates").doc(certificateId);
    const profileRef = db.collection("certificateProfiles").doc(userId);
    const inboxRef = db.collection("certificateInboxes").doc(userId).collection("messages").doc(certificateId);
    const ok = await db.runTransaction(async tx => {
      const [claimDoc, existing, counts] = await Promise.all([tx.get(doc.ref), tx.get(certRef), tx.get(profileRef)]);
      if (!claimDoc.exists || claimDoc.get("claimed")) return false;
      const now = Date.now();
      if (!existing.exists) {
        tx.set(certRef, {
          schemaVersion: 1, userId, title: data.title, imageUrl: `/api/certificates/${certificateId}/image`, assetId: data.assetId,
          source: "internal", issuerId: data.issuerId, issuerName: data.issuerName, ...(data.eventId ? { eventId: data.eventId } : {}),
          jobId: data.jobId, rowId: data.rowId, createdAt: now, visibility: "private", status: "active", profileAwarded: true,
        });
        tx.set(inboxRef, { schemaVersion: 1, recipientId: userId, issuerId: data.issuerId, issuerName: data.issuerName, certificateId, title: data.title, body: `${data.issuerName} sent you a certificate. It is now saved to your profile.`, createdAt: now });
        tx.set(profileRef, { schemaVersion: 1, certificateCount: (counts.get("certificateCount") || 0) + 1, internalCount: (counts.get("internalCount") || 0) + 1, externalCount: counts.get("externalCount") || 0, updatedAt: now }, { merge: true });
      }
      tx.update(doc.ref, { claimed: true, claimedBy: userId, claimedAt: now, certificateId });
      return true;
    });
    if (ok) awarded++;
  }
  return awarded;
}
