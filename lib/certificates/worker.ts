import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { firestore } from "@/lib/firebase-admin";
import { certificateRecipientDirectory } from "@/lib/auth-store";
import { assetBytes, getAsset, saveAsset } from "./assets";
import { jobs, leaseJob, guardedJobWrite, internalAward, finishRow, releaseJobToQueue } from "./store";
import { renderPng } from "./node-render";
import { certificateMail, certificateTransport } from "./email";
import { matchRecipient } from "./matching";
import type { JobRecord, JobRow, Layout } from "./model";
import { reserveVerification, activateVerification } from "./verification-store";

/**
 * Processes a job's rows. With no `deadline`, runs to completion (the
 * standalone worker's usage). Passed a `deadline` (a `Date.now()`-comparable
 * timestamp), it stops cleanly between rows once time is up, hands the job
 * back to the queue via `releaseJobToQueue` so the next chunk can claim it
 * immediately, and returns `"partial"` instead of finalizing — this is what
 * lets request-scoped callers (an API route bounded by a serverless timeout)
 * make bounded forward progress across repeated calls instead of owning the
 * whole batch in one invocation.
 */
export async function processJob(job: JobRecord, deadline = Infinity): Promise<"completed" | "partial" | "failed"> {
  const dir = await mkdtemp(join(tmpdir(), "smart-campus-certificates-"));
  let heartbeatError = false;
  let timeUp = false;
  const heartbeat = setInterval(() => { void guardedJobWrite(job, { leaseExpiresAt: Date.now() + 120_000 }).catch(() => { heartbeatError = true; }); }, 25_000);
  let mailer: ReturnType<typeof certificateTransport> | null = null;
  try {
    mailer = job.requestedActions.email ? certificateTransport() : null;
    const revision = await firestore().collection("certificateTemplates").doc(job.templateId).collection("revisions").doc(job.revisionId).get();
    if (!revision.exists) throw new Error("Template revision is missing");
    const layout = revision.data() as Layout;
    const bg = revision.get("backgroundAssetId") ? await getAsset(revision.get("backgroundAssetId")) : null;
    const background = bg ? await assetBytes(bg) : undefined;
    const users = job.requestedActions.email || job.requestedActions.internalDelivery ? await certificateRecipientDirectory() : [];
    let cursor = "";
    const archive = new JSZip();
    const manifest: Array<Record<string, unknown>> = [];
    let archiveBytes = 0;
    while (true) {
      let query = jobs().doc(job.id).collection("rows").orderBy("__name__").limit(20);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) {
        if (heartbeatError) throw new Error("Job lease lost");
        if (Date.now() >= deadline) { timeUp = true; break; }
        await guardedJobWrite(job, { leaseExpiresAt: Date.now() + 120_000 });
        const row = { ...doc.data(), id: doc.id } as JobRow; cursor = row.id;
        const update = async (patch: Partial<JobRow>) => { await guardedJobWrite(job, {}, row.id, patch); Object.assign(row, patch); };
        if (!row.processed) {
          if (row.matchStatus === "pending") {
            const match = matchRecipient(users, row.values[job.columnMapping.email || ""] || "", row.values[job.columnMapping.username || ""] || "");
            await update({ matchStatus: match.status, matchReason: match.reason, emailNormalized: match.email, ...(match.userId ? { matchedUserId: match.userId } : {}) });
          }
          if (row.renderStatus === "pending") {
            try {
              Object.assign(row, await reserveVerification(firestore(), job, row));
              const png = await renderPng(layout, row, background);
              const asset = await saveAsset(job.organizerId, "certificate", png, "image/png", job.id);
              await activateVerification(firestore(), job, row, asset.id);
              Object.assign(row, { renderStatus: "ready", assetId: asset.id });
            } catch { await update({ renderStatus: "failed", lastError: "PNG generation failed. Check image dimensions and template fonts." }); }
          }
          if (row.renderStatus === "ready" && row.internalStatus === "pending") {
            if (!row.matchedUserId) await update({ internalStatus: "skipped" });
            else {
              try { const certificateId = await internalAward(job, row, job.leaseToken); Object.assign(row, { certificateId, internalStatus: "delivered" }); }
              catch { await update({ internalStatus: "failed", lastError: "Could not save the certificate to the recipient profile and inbox." }); }
            }
          }
          if (row.emailStatus === "sending") await update({ emailStatus: "unknown", lastError: "Previous SMTP attempt was interrupted; review before retrying to avoid duplicate mail." });
          if (row.renderStatus === "ready" && row.emailStatus === "pending") {
            if (!row.emailNormalized) await update({ emailStatus: "skipped", lastError: "No valid recipient email address." });
            else {
              // Persist intent before contacting SMTP. A crash after this point
              // must not silently send the same email again.
              const asset = await getAsset(row.assetId!);
              if (!asset) throw new Error("Rendered artifact missing");
              const message = certificateMail(job, row, await assetBytes(asset));
              await update({ emailStatus: "sending", emailAttempts: row.emailAttempts + 1, emailMessageId: message.messageId });
              try {
                const result = await mailer!.sendMail(message);
                await update({ emailStatus: result.accepted.length ? "accepted" : "failed" });
              } catch (error) {
                // An explicit SMTP rejection is safe to retry; a transport
                // timeout/disconnect may have happened after server acceptance.
                const code = (error as { responseCode?: number }).responseCode;
                await update({ emailStatus: code && code >= 400 ? "failed" : "unknown", lastError: code ? "SMTP rejected this message." : "SMTP outcome is unknown; review before retrying." });
              }
            }
          }
          if (row.renderStatus === "failed") await update({ ...(row.internalStatus === "pending" ? { internalStatus: "failed" } : {}), ...(row.emailStatus === "pending" ? { emailStatus: "failed" } : {}) });
          const failed = row.renderStatus === "failed" || row.internalStatus === "failed" || ["failed", "unknown", "skipped"].includes(row.emailStatus);
          await finishRow(job, row, failed);
        }
        manifest.push({ row: row.rowNumber, verificationCode: row.verificationCode, rendered: row.renderStatus, match: row.matchStatus, internal: row.internalStatus, email: row.emailStatus });
        if (job.requestedActions.archive && row.assetId && row.renderStatus === "ready") {
          const asset = await getAsset(row.assetId);
          if (asset) {
            archiveBytes += asset.byteSize;
            if (archiveBytes > 500 * 1024 * 1024) throw new Error("Archive exceeds 500 MB; split this batch");
            const path = join(dir, `${row.id}.png`);
            await writeFile(path, await assetBytes(asset));
            archive.file(`certificate-${row.rowNumber}.png`, createReadStream(path));
          }
        }
      }
      if (timeUp || page.size < 20) break;
    }
    if (timeUp) { await releaseJobToQueue(job); return "partial"; }
    if (job.requestedActions.archive) {
      await guardedJobWrite(job, { archiveStatus: "running" });
      archive.file("delivery-report.json", JSON.stringify(manifest, null, 2));
      const path = join(dir, "certificates.zip");
      await pipeline(archive.generateNodeStream({ streamFiles: true, compression: "STORE" }), createWriteStream(path));
      const asset = await saveAsset(job.organizerId, "archive", path, "application/zip", job.id);
      await guardedJobWrite(job, { archiveStatus: "ready", archiveAssetId: asset.id });
    }
    const fresh = await jobs().doc(job.id).get();
    await guardedJobWrite(job, { status: fresh.get("failedRows") ? "completed_with_errors" : "completed", leaseExpiresAt: 0, completedAt: Date.now() });
    return "completed";
  } catch (error) {
    if (!heartbeatError) {
      const message = error instanceof Error && error.message.includes("500 MB") ? error.message : "Processing interrupted. Check worker configuration and retry the job.";
      await guardedJobWrite(job, { status: "failed", lastError: message, leaseExpiresAt: 0, ...(job.requestedActions.archive ? { archiveStatus: "failed" } : {}) }).catch(() => undefined);
    }
    return "failed";
  } finally { clearInterval(heartbeat); mailer?.close(); await rm(dir, { recursive: true, force: true }); }
}

export async function runWorker(once = false) {
  let stopped = false;
  process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
  console.info("Certificate worker ready. Waiting for queued jobs.");
  do {
    const job = await leaseJob();
    if (job) { console.info(`Processing certificate job ${job.id}`); await processJob(job); }
    else if (!once) await new Promise(resolve => setTimeout(resolve, 3000));
  } while (!once && !stopped);
}
