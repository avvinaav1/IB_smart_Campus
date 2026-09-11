import "server-only";
import { customAlphabet } from "nanoid";
import type { Firestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import type { JobRecord, JobRow } from "./model";
import { resolveColumn } from "./columns";
import { CODE_ALPHABET, CODE_LENGTH, publicVerification } from "./verification-code";

export const generateVerificationCode = customAlphabet(CODE_ALPHABET, CODE_LENGTH);
function requireLease(lock: { get(field: string): unknown }, job: JobRecord) {
  if (lock.get("status") !== "running" || lock.get("leaseToken") !== job.leaseToken || Number(lock.get("leaseExpiresAt")) <= Date.now()) throw new Error("Job lease lost");
}
// Firestore has no UNIQUE constraint. A transaction creates a document keyed
// by the code and pins it to the job row before any PNG or email is generated.
export async function reserveVerification(db: Firestore, job: JobRecord, row: JobRow, generate = generateVerificationCode) {
  const jobRef = db.collection("certificateJobs").doc(job.id), rowRef = jobRef.collection("rows").doc(row.id);
  const certificateId = createHash("sha256").update(JSON.stringify(["issued", job.id, row.id])).digest("hex");
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generate();
    const reserved = await db.runTransaction(async tx => {
      const [lock, fresh, codeDoc] = await Promise.all([tx.get(jobRef), tx.get(rowRef), tx.get(db.collection("certificateVerificationCodes").doc(code))]);
      requireLease(lock, job);
      if (fresh.get("verificationCode")) return { verificationCode: fresh.get("verificationCode") as string, certificateId: fresh.get("certificateId") as string };
      if (codeDoc.exists) return null;
      tx.create(codeDoc.ref, { certificateId, jobId: job.id, rowId: row.id, createdAt: Date.now() });
      tx.update(rowRef, { verificationCode: code, certificateId });
      return { verificationCode: code, certificateId };
    });
    if (reserved) return reserved;
  }
  throw new Error("Unable to reserve a unique verification code");
}

export async function activateVerification(db: Firestore, job: JobRecord, row: JobRow, assetId: string) {
  if (!row.verificationCode || !row.certificateId) throw new Error("Verification code is missing");
  const jobRef = db.collection("certificateJobs").doc(job.id), rowRef = jobRef.collection("rows").doc(row.id);
  const ref = db.collection("certificates").doc(row.certificateId);
  const nameColumn = job.columnMapping.displayName || resolveColumn("name", Object.keys(row.values));
  const courseColumn = resolveColumn("course", Object.keys(row.values));
  await db.runTransaction(async tx => {
    const [lock, existing, reserved, fresh] = await Promise.all([tx.get(jobRef), tx.get(ref), tx.get(db.collection("certificateVerificationCodes").doc(row.verificationCode!)), tx.get(rowRef)]);
    requireLease(lock, job);
    if (reserved.get("certificateId") !== ref.id || fresh.get("verificationCode") !== row.verificationCode) throw new Error("Verification reservation mismatch");
    if (!existing.exists) {
      const issuedAt = Date.now();
      tx.create(ref, { schemaVersion: 2, title: job.title, assetId, imageUrl: `/api/certificates/${ref.id}/image`, source: "internal", issuerId: job.organizerId, issuerName: job.issuerName, jobId: job.id, rowId: row.id, ...(job.eventId ? { eventId: job.eventId } : {}), verificationCode: row.verificationCode, recipientName: (nameColumn && row.values[nameColumn]) || (job.columnMapping.username && row.values[job.columnMapping.username]) || "Recipient not provided", courseName: (courseColumn && row.values[courseColumn]) || job.title, issuedAt, createdAt: issuedAt, visibility: "private", status: "active", profileAwarded: false });
    }
    tx.update(rowRef, { renderStatus: "ready", assetId, verificationCode: row.verificationCode, certificateId: ref.id });
  });
}

export async function lookupVerification(db: Firestore, code: string) {
  const index = await db.collection("certificateVerificationCodes").doc(code).get();
  if (!index.exists) return null;
  const certificate = await db.collection("certificates").doc(index.get("certificateId")).get();
  return publicVerification(certificate.data(), code);
}

