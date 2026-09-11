import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/lib/firebase-admin";
import { getDirectoryUser } from "@/lib/auth-store";
import { getRelationshipStates } from "@/lib/social-store";
import { getEvent } from "@/lib/event-store";
import { getAsset, saveAsset } from "./assets";
import { badgeFor, type CertificateRecord, type CertificateStats, type JobInput, type JobRecord, type JobRow } from "./model";

export const hashId = (...parts: string[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const jobs = () => firestore().collection("certificateJobs");
export const certs = () => firestore().collection("certificates");
export async function statsFor(userId: string): Promise<CertificateStats> {
  const value = (await firestore().collection("certificateProfiles").doc(userId).get()).data();
  const certificateCount = value?.certificateCount ?? 0;
  return { certificateCount, internalCount: value?.internalCount ?? 0, externalCount: value?.externalCount ?? 0, certificateBadge: badgeFor(certificateCount) };
}
export async function canViewProfile(owner: string, viewer?: string) {
  if (owner === viewer) return true;
  const user = await getDirectoryUser(owner);
  if (!user) return false;
  if (!user.isPrivate) return true;
  return Boolean(viewer && (await getRelationshipStates(viewer, [owner]))[owner]?.followStatus === "accepted");
}
export async function getCertificate(id: string) { const doc = await certs().doc(id).get(); return doc.exists ? { ...doc.data(), id } as CertificateRecord : null; }
export async function mayViewCertificate(certificate: CertificateRecord, viewer?: string) {
  if (certificate.status !== "active") return false;
  if (viewer && (certificate.userId === viewer || certificate.issuerId === viewer)) return true;
  return Boolean(certificate.userId && certificate.visibility === "public" && await canViewProfile(certificate.userId, viewer));
}
export async function listCertificates(userId: string, viewer?: string, cursor?: string) {
  if (!await canViewProfile(userId, viewer)) throw new Error("Profile is private");
  let query = certs().where("userId", "==", userId).where("status", "==", "active");
  if (viewer !== userId) query = query.where("visibility", "==", "public");
  query = query.orderBy("createdAt", "desc").orderBy("__name__", "desc");
  if (cursor) { const snapshot = await certs().doc(cursor).get(); if (snapshot.exists && snapshot.get("userId") === userId) query = query.startAfter(snapshot); }
  const page = await query.limit(24).get();
  const certificates = page.docs.map(d => {
    const c = { ...d.data(), id: d.id } as CertificateRecord;
    return { id: c.id, userId: c.userId, title: c.title, imageUrl: c.imageUrl, source: c.source, issuerName: c.issuerName, createdAt: c.createdAt, visibility: c.visibility, status: c.status };
  });
  return { certificates, stats: await statsFor(userId), nextCursor: page.size === 24 ? page.docs.at(-1)!.id : null };
}
export async function addExternal(userId: string, assetId: string, title: string, issuerName: string, key: string) {
  const asset = await getAsset(assetId);
  if (!asset || asset.ownerId !== userId || asset.kind !== "certificate") throw new Error("Certificate upload not found");
  const id = hashId("external", userId, key), ref = certs().doc(id), profile = firestore().collection("certificateProfiles").doc(userId);
  return firestore().runTransaction(async tx => {
    const [existing, counts] = await Promise.all([tx.get(ref), tx.get(profile)]);
    if (existing.exists) {
      if (existing.get("assetId") !== assetId || existing.get("title") !== title || existing.get("issuerName") !== issuerName) throw new Error("Upload key already used for another certificate");
      return id;
    }
    tx.set(ref, { schemaVersion: 1, userId, title, assetId, imageUrl: `/api/certificates/${id}/image`, source: "external", issuerName, visibility: "private", status: "active", createdAt: Date.now() });
    tx.set(profile, { schemaVersion: 1, certificateCount: (counts.get("certificateCount") || 0) + 1, externalCount: (counts.get("externalCount") || 0) + 1, internalCount: counts.get("internalCount") || 0, updatedAt: Date.now() });
    return id;
  });
}
export async function changeCertificate(id: string, userId: string, change: "public" | "private" | "deleted") {
  const ref = certs().doc(id), profile = firestore().collection("certificateProfiles").doc(userId);
  await firestore().runTransaction(async tx => {
    const [doc, counts] = await Promise.all([tx.get(ref), tx.get(profile)]);
    if (!doc.exists || doc.get("userId") !== userId) throw new Error("Certificate not found");
    if (doc.get("status") === "deleted") return;
    if (change !== "deleted") { tx.update(ref, { visibility: change }); return; }
    tx.update(ref, { status: "deleted", deletedAt: Date.now() });
    const field = doc.get("source") === "internal" ? "internalCount" : "externalCount";
    tx.set(profile, { certificateCount: Math.max(0, (counts.get("certificateCount") || 0) - 1), [field]: Math.max(0, (counts.get(field) || 0) - 1), updatedAt: Date.now() }, { merge: true });
  });
}
export async function createJob(input: JobInput, organizerId: string, issuerName: string, key: string) {
  if (input.eventId && !(await getEvent(input.eventId, organizerId))?.canManageEvent) throw new Error("You cannot issue certificates for that event");
  if (input.backgroundAssetId) { const asset = await getAsset(input.backgroundAssetId); if (!asset || asset.ownerId !== organizerId || asset.kind !== "background") throw new Error("Background not found"); }
  const id = hashId(organizerId, key), ref = jobs().doc(id), digest = hashId(JSON.stringify(input));
  const previous = await ref.get();
  if (previous.exists && previous.get("inputDigest") !== digest) throw new Error("Request key reused with different data");
  if (previous.exists && previous.get("status") !== "draft") return id;
  const importAssetId = previous.get("importAssetId") || (await saveAsset(organizerId, "import", Buffer.from(JSON.stringify(input)), "application/json", id)).id;
  const { rows, layout, backgroundAssetId, ...metadata } = input;
  const now = Date.now();
  const state = await firestore().runTransaction(async tx => {
    const old = await tx.get(ref);
    if (old.exists) { if (old.get("inputDigest") !== digest) throw new Error("Request key reused with different data"); return old.get("status"); }
    tx.set(ref, { ...metadata, schemaVersion: 1, organizerId, issuerName, inputDigest: digest, requestKey: key, importAssetId, templateId: id, revisionId: "1", status: "draft", totalRows: rows.length, processedRows: 0, failedRows: 0, createdAt: now, updatedAt: now, leaseToken: "", leaseExpiresAt: 0, attempts: 0, nextAttemptAt: 0, archiveStatus: input.requestedActions.archive ? "queued" : "not_requested" });
    return "draft";
  });
  if (state !== "draft") return id;
  // Draft rows are written with create(), never set(): retried initialization cannot
  // overwrite a row after another request has queued the job.
  const writer = firestore().bulkWriter();
  writer.onWriteError(error => error.code !== 6 && error.failedAttempts < 3);
  const writes = rows.map((row, i) => writer.create(ref.collection("rows").doc(String(i + 1).padStart(6, "0")), { ...row, schemaVersion: 1, rowNumber: i + 1, matchStatus: "pending", renderStatus: "pending", internalStatus: input.requestedActions.internalDelivery ? "pending" : "not_requested", emailStatus: input.requestedActions.email ? "pending" : "not_requested", emailAttempts: 0, processed: false, createdAt: now, updatedAt: now }).catch((e: { code?: number }) => { if (e.code !== 6) throw e; }));
  await Promise.all([writer.close(), Promise.all(writes)]);
  const template = firestore().collection("certificateTemplates").doc(id);
  await template.set({ ownerId: organizerId, title: input.title, currentRevisionId: "1", createdAt: now, updatedAt: now });
  await template.collection("revisions").doc("1").set({ schemaVersion: 1, ...layout, ...(backgroundAssetId ? { backgroundAssetId } : {}), createdAt: now });
  await firestore().runTransaction(async tx => { const doc = await tx.get(ref); if (doc.get("status") === "draft") tx.update(ref, { status: "queued", updatedAt: Date.now() }); });
  return id;
}
export async function jobForOwner(id: string, ownerId: string) { const doc = await jobs().doc(id).get(); if (!doc.exists || doc.get("organizerId") !== ownerId) throw new Error("Job not found"); return { ...doc.data(), id } as JobRecord; }
export async function internalAward(job: JobRecord, row: JobRow, leaseToken: string, db = firestore()) {
  if (!row.matchedUserId || !row.assetId) throw new Error("Recipient or image missing");
  const id = row.certificateId || hashId(job.id, row.id, row.matchedUserId), ref = db.collection("certificates").doc(id);
  const jobRef = db.collection("certificateJobs").doc(job.id);
  const profile = db.collection("certificateProfiles").doc(row.matchedUserId);
  const inbox = db.collection("certificateInboxes").doc(row.matchedUserId).collection("messages").doc(id);
  await db.runTransaction(async tx => {
    const [lock, existing, counts] = await Promise.all([tx.get(jobRef), tx.get(ref), tx.get(profile)]);
    if (lock.get("leaseToken") !== leaseToken || lock.get("status") !== "running" || lock.get("leaseExpiresAt") < Date.now()) throw new Error("Job lease lost");
    const now = Date.now();
    if (!existing.exists || existing.get("profileAwarded") === false) {
      if (!existing.exists) tx.set(ref, { schemaVersion: 1, userId: row.matchedUserId, title: job.title, imageUrl: `/api/certificates/${id}/image`, assetId: row.assetId, source: "internal", issuerId: job.organizerId, issuerName: job.issuerName, ...(job.eventId ? { eventId: job.eventId } : {}), jobId: job.id, rowId: row.id, createdAt: now, visibility: "private", status: "active", profileAwarded: true });
      else tx.update(ref, { userId: row.matchedUserId, profileAwarded: true });
      tx.set(inbox, { schemaVersion: 1, recipientId: row.matchedUserId, issuerId: job.organizerId, issuerName: job.issuerName, certificateId: id, title: job.title, body: `${job.issuerName} sent you a certificate. It is also saved to your profile.`, createdAt: now });
      tx.set(profile, { schemaVersion: 1, certificateCount: (counts.get("certificateCount") || 0) + 1, internalCount: (counts.get("internalCount") || 0) + 1, externalCount: counts.get("externalCount") || 0, updatedAt: now });
    }
    tx.update(jobRef.collection("rows").doc(row.id), { certificateId: id, internalStatus: "delivered", updatedAt: now });
  });
  return id;
}
export async function leaseJob() {
  // Query by status alone (built-in index); candidates include queued work and
  // running jobs whose worker died. Firestore transaction decides ownership.
  const [queued, expired] = await Promise.all([
    jobs().where("status", "==", "queued").orderBy("createdAt").limit(10).get(),
    jobs().where("status", "==", "running").where("leaseExpiresAt", "<=", Date.now()).orderBy("leaseExpiresAt").limit(10).get(),
  ]);
  for (const candidate of [...expired.docs, ...queued.docs]) {
    const job = await firestore().runTransaction(async tx => {
      const doc = await tx.get(candidate.ref), now = Date.now();
      if (!["queued", "running"].includes(doc.get("status")) || (doc.get("leaseExpiresAt") || 0) > now || (doc.get("nextAttemptAt") || 0) > now) return null;
      const patch = { status: "running", leaseToken: randomUUID(), leaseExpiresAt: now + 120_000, attempts: (doc.get("attempts") || 0) + 1, updatedAt: now };
      tx.update(doc.ref, patch); return { ...doc.data(), ...patch, id: doc.id } as JobRecord;
    });
    if (job) return job;
  }
  return null;
}
// Claims one specific job for inline (request-scoped) processing, e.g. right
// after creation or from a status poll — as opposed to leaseJob(), which picks
// whichever queued/expired job comes up next for a standalone worker loop.
// Returns null if the job isn't claimable right now (already leased by another
// call, or in a terminal/draft state); callers should treat that as "nothing to
// do" rather than an error.
export async function leaseJobById(id: string, organizerId: string) {
  const ref = jobs().doc(id);
  return firestore().runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.get("organizerId") !== organizerId) return null;
    const status = doc.get("status"), now = Date.now();
    if (!["queued", "running"].includes(status)) return null;
    if (status === "running" && (doc.get("leaseExpiresAt") || 0) > now) return null;
    if ((doc.get("nextAttemptAt") || 0) > now) return null;
    const patch = { status: "running", leaseToken: randomUUID(), leaseExpiresAt: now + 120_000, attempts: (doc.get("attempts") || 0) + 1, updatedAt: now };
    tx.update(ref, patch); return { ...doc.data(), ...patch, id: doc.id } as JobRecord;
  });
}
// Hands a job back to the queue without waiting out its lease, so the next
// request-scoped chunk can pick it up immediately instead of stalling for up
// to 120s. Used when a chunk runs out of time budget with rows still pending.
export async function releaseJobToQueue(job: JobRecord) {
  await guardedJobWrite(job, { status: "queued", leaseToken: "", leaseExpiresAt: 0 });
}
export async function guardedJobWrite(job: JobRecord, patch: Record<string, unknown>, rowId?: string, rowPatch?: Record<string, unknown>) {
  await firestore().runTransaction(async tx => {
    const ref = jobs().doc(job.id), doc = await tx.get(ref);
    if (doc.get("leaseToken") !== job.leaseToken || doc.get("status") !== "running" || doc.get("leaseExpiresAt") < Date.now()) throw new Error("Job lease lost");
    tx.update(ref, { ...patch, updatedAt: Date.now() });
    if (rowId && rowPatch) tx.update(ref.collection("rows").doc(rowId), { ...rowPatch, updatedAt: Date.now() });
  });
}
export async function finishRow(job: JobRecord, row: JobRow, failed: boolean) {
  await guardedJobWrite(job, { processedRows: FieldValue.increment(1), ...(failed ? { failedRows: FieldValue.increment(1) } : {}) }, row.id, { processed: true });
}
