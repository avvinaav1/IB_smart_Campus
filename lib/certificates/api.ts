import "server-only";
import { Readable } from "node:stream";
import { z } from "zod";
import sharp from "sharp";
import type { NextRequest } from "next/server";
import { firestore } from "@/lib/firebase-admin";
import { getSession, certificateRecipientDirectory, getDirectoryUser } from "@/lib/auth-store";
import { isSameOrigin, SESSION_COOKIE } from "@/lib/auth-http";
import { assetBytes, assetChunks, getAsset, saveAsset } from "./assets";
import { addExternal, canViewProfile, changeCertificate, createJob, getCertificate, jobForOwner, jobs, leaseJobById, listCertificates, mayViewCertificate, statsFor } from "./store";
import { jobInputSchema, layoutSchema, MAX_UPLOAD, type JobRow } from "./model";
import { matchRecipient } from "./matching";
import { smtpConfigured } from "./email";
import { mayManageCertificates } from "./access";
import { processJob } from "./worker";

class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
// There's no standalone worker process to rely on in a serverless deployment,
// so requests themselves drive a queued job forward: whichever request gets
// here first (creation, a retry, or the next status poll) claims the job and
// processes rows until either it finishes or this budget runs out, then hands
// the job back to the queue for the next request to continue. Keep this well
// under the route's `maxDuration` so a chunk always gets to finalize cleanly.
const JOB_CHUNK_BUDGET_MS = 45_000;
async function advanceJob(jobId: string, organizerId: string) {
  try {
    const leased = await leaseJobById(jobId, organizerId);
    if (!leased) return; // already being processed by another request, or not resumable right now
    await processJob(leased, Date.now() + JOB_CHUNK_BUDGET_MS);
  } catch {
    // processJob persists any failure onto the job itself; a request that
    // merely triggered a chunk must not fail because that chunk hit trouble.
  }
}
const json = (data: unknown, status = 200) => Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
const keySchema = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);
async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max) throw new ApiError("Request is too large", 413);
  const reader = request.body?.getReader(); if (!reader) throw new ApiError("Request body is required");
  const chunks: Uint8Array[] = []; let total = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > max) { await reader.cancel(); throw new ApiError("Request is too large", 413); } chunks.push(value); }
  return Buffer.concat(chunks);
}
async function bodyJson(request: Request) { try { return JSON.parse((await boundedBody(request, 6 * 1024 * 1024)).toString("utf8")); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("Invalid JSON"); } }
function safeId(id: string) { if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ApiError("Invalid identifier"); return id; }
async function assetResponse(id: string, filename?: string) {
  const asset = await getAsset(id); if (!asset) throw new ApiError("Image or archive not found", 404);
  return new Response(Readable.toWeb(Readable.from(assetChunks(asset))) as ReadableStream<Uint8Array>, { headers: { "Content-Type": asset.contentType, "Content-Length": String(asset.byteSize), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}) } });
}

export async function handleCertificates(request: NextRequest, path: string[]) {
  try {
    path.forEach(safeId);
    const method = request.method;
    if (!["GET", "HEAD"].includes(method) && !isSameOrigin(request)) throw new ApiError("Request origin rejected", 403);
    const user = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
    // Public profiles expose only explicitly public certificates and respect
    // the existing private-profile/follower policy.
    if (method === "GET" && path[0] === "profiles" && path.length === 2) {
      const owner = await getDirectoryUser(path[1]); if (!owner || !await canViewProfile(path[1], user?.id)) throw new ApiError("Profile not available", 404);
      return json({ ...await listCertificates(path[1], user?.id, request.nextUrl.searchParams.get("cursor") || undefined), user: owner });
    }
    if (method === "GET" && path.length === 2 && path[1] === "image") {
      const c = await getCertificate(path[0]); if (!c || !await mayViewCertificate(c, user?.id)) throw new ApiError("Certificate not found", 404);
      return assetResponse(c.assetId, request.nextUrl.searchParams.has("download") ? `certificate-${c.id}.png` : undefined);
    }
    if (!user) throw new ApiError("Sign in to save or deliver certificates. Local preview supports editing and ZIP export.", 401);
    if (method === "GET" && path[0] === "access" && path.length === 1) return json({ canManage: await mayManageCertificates(user) });
    if (method === "GET" && !path.length) return json(await listCertificates(user.id, user.id, request.nextUrl.searchParams.get("cursor") || undefined));
    if (path[0] === "inbox") {
      const messages = firestore().collection("certificateInboxes").doc(user.id).collection("messages");
      if (method === "GET" && path.length === 1) {
        let query = messages.orderBy("createdAt", "desc").orderBy("__name__", "desc");
        const cursor = request.nextUrl.searchParams.get("cursor"); if (cursor) { const doc = await messages.doc(safeId(cursor)).get(); if (doc.exists) query = query.startAfter(doc); }
        const page = await query.limit(24).get();
        return json({ messages: page.docs.map(d => ({ ...d.data(), id: d.id, imageUrl: `/api/certificates/${d.get("certificateId")}/image` })), nextCursor: page.size === 24 ? page.docs.at(-1)!.id : null });
      }
      if (method === "PATCH" && path.length === 2) { const ref = messages.doc(path[1]); if (!(await ref.get()).exists) throw new ApiError("Message not found", 404); await ref.update({ readAt: Date.now() }); return json({ ok: true }); }
    }
    if (!await mayManageCertificates(user)) throw new ApiError("Certificate management requires Super Admin, App Moderator, or Institute Admin access.", 403);
    if (path[0] === "assets" && method === "POST" && path.length === 1) {
      const raw = await boundedBody(request, MAX_UPLOAD + 65536);
      const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") || "" }, body: raw }).formData();
      const file = form.get("file"), kind = form.get("kind");
      if (!(file instanceof File) || !["background", "certificate"].includes(String(kind)) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_UPLOAD) throw new ApiError("Upload a PNG, JPG or WebP image up to 8 MB");
      let bytes: Buffer;
      try { bytes = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 8_000_000, animated: false }).rotate().png().toBuffer(); } catch { throw new ApiError("Invalid image or dimensions exceed 8 megapixels"); }
      if (bytes.length > MAX_UPLOAD) throw new ApiError("Normalized image exceeds 8 MB");
      const asset = await saveAsset(user.id, kind as "background" | "certificate", bytes, "image/png");
      return json({ assetId: asset.id, url: `/api/certificates/assets/${asset.id}` }, 201);
    }
    if (path[0] === "assets" && method === "GET" && path.length === 2) {
      const asset = await getAsset(path[1]); if (!asset || asset.ownerId !== user.id) throw new ApiError("Asset not found", 404);
      return assetResponse(asset.id);
    }
    if (path[0] === "external" && method === "POST" && path.length === 1) {
      const data = z.object({ assetId: keySchema, title: z.string().trim().min(1).max(160), issuerName: z.string().trim().min(1).max(160), key: keySchema }).parse(await bodyJson(request));
      const certificateId = await addExternal(user.id, data.assetId, data.title, data.issuerName, data.key);
      return json({ certificateId, stats: await statsFor(user.id) }, 201);
    }
    if (path[0] === "match" && method === "POST") {
      const input = jobInputSchema.parse(await bodyJson(request)), users = await certificateRecipientDirectory();
      return json({ matches: input.rows.map((row, i) => {
        const match = matchRecipient(users, row.values[input.columnMapping.email || ""] || "", row.values[input.columnMapping.username || ""] || "");
        return { rowNumber: i + 1, status: match.status, reason: match.reason };
      }) });
    }
    if (path[0] === "jobs" && path.length === 1 && method === "POST") {
      const input = jobInputSchema.parse(await bodyJson(request));
      if (input.requestedActions.email && !smtpConfigured()) throw new ApiError("SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and CERTIFICATE_FROM_EMAIL.", 503);
      if (!input.allowDistinctAwards && (input.requestedActions.email || input.requestedActions.internalDelivery)) {
        const directory = await certificateRecipientDirectory(), seen = new Set<string>();
        for (const row of input.rows) {
          const match = matchRecipient(directory, row.values[input.columnMapping.email || ""] || "", row.values[input.columnMapping.username || ""] || "");
          for (const value of [match.userId, match.email].filter(Boolean)) {
            if (seen.has(value!)) throw new ApiError("Duplicate recipients found. Remove duplicate rows or explicitly allow distinct awards per recipient.");
            seen.add(value!);
          }
        }
      }
      const key = keySchema.parse(request.headers.get("idempotency-key"));
      const jobId = await createJob(input, user.id, user.username, key);
      await advanceJob(jobId, user.id);
      return json({ jobId }, 202);
    }
    if (path[0] === "jobs" && path.length === 1 && method === "GET") {
      const page = await jobs().where("organizerId", "==", user.id).orderBy("createdAt", "desc").limit(20).get();
      return json({ jobs: page.docs.map(d => ({ id: d.id, title: d.get("title"), status: d.get("status"), processedRows: d.get("processedRows"), totalRows: d.get("totalRows"), failedRows: d.get("failedRows"), archiveStatus: d.get("archiveStatus"), createdAt: d.get("createdAt"), lastError: d.get("lastError") || "" })) });
    }
    if (path[0] === "jobs" && path.length >= 2) {
      const job = await jobForOwner(path[1], user.id);
      if (method === "GET" && path[2] === "download") { if (job.archiveStatus !== "ready" || !job.archiveAssetId) throw new ApiError("Archive is not ready", 409); return assetResponse(job.archiveAssetId, "certificates.zip"); }
      if (method === "GET" && path.length === 2) {
        // Each status poll is also this job's chance to make progress: claim
        // and run one bounded chunk (a no-op if another request already holds
        // the lease) before reading back the rows below, so the client sees
        // this call's own progress rather than waiting for the next poll.
        const current = ["queued", "running"].includes(job.status) ? await (async () => { await advanceJob(job.id, user.id); return jobForOwner(job.id, user.id); })() : job;
        let query = jobs().doc(job.id).collection("rows").orderBy("__name__").limit(50);
        const cursor = request.nextUrl.searchParams.get("cursor"); if (cursor) query = query.startAfter(safeId(cursor));
        const page = await query.get();
        return json({ job: { id: current.id, title: current.title, status: current.status, processedRows: current.processedRows, failedRows: current.failedRows, totalRows: current.totalRows, archiveStatus: current.archiveStatus, lastError: current.lastError }, rows: page.docs.map(d => { const r = d.data() as JobRow; return { id: d.id, rowNumber: r.rowNumber, matchStatus: r.matchStatus, matchReason: r.matchReason, renderStatus: r.renderStatus, emailStatus: r.emailStatus, internalStatus: r.internalStatus, lastError: r.lastError, imageUrl: r.assetId ? `/api/certificates/assets/${r.assetId}` : undefined }; }), nextCursor: page.size === 50 ? page.docs.at(-1)!.id : null });
      }
      if (method === "PATCH" && path.length === 2) {
        const data = z.object({ action: z.enum(["cancel", "retry"]), retryUnknownEmail: z.boolean().default(false) }).parse(await bodyJson(request));
        const ref = jobs().doc(job.id);
        if (data.action === "cancel") {
          await firestore().runTransaction(async tx => { const doc = await tx.get(ref); if (["queued", "running", "draft"].includes(doc.get("status"))) tx.update(ref, { status: "cancelled", leaseToken: "", leaseExpiresAt: 0, updatedAt: Date.now() }); });
        } else {
          if (job.status === "draft") {
            const snapshot = await ref.get(), source = await getAsset(snapshot.get("importAssetId"));
            if (!source) throw new ApiError("Original batch data is unavailable. Submit the design again.", 409);
            const input = jobInputSchema.parse(JSON.parse((await assetBytes(source)).toString("utf8")));
            const newJobId = await createJob(input, user.id, user.username, snapshot.get("requestKey"));
            await advanceJob(newJobId, user.id);
            return json({ ok: true });
          }
          // Keep the job unclaimable while retryable row states are reset.
          await firestore().runTransaction(async tx => { const doc = await tx.get(ref); if (!["failed", "completed_with_errors", "cancelled"].includes(doc.get("status")) && !(doc.get("status") === "retrying" && doc.get("leaseExpiresAt") < Date.now())) throw new ApiError("Job cannot be retried yet", 409); tx.update(ref, { status: "retrying", leaseToken: "", leaseExpiresAt: Date.now() + 120_000 }); });
          try {
            const writer = firestore().bulkWriter();
            const rows = await ref.collection("rows").get();
            let processed = 0, failed = 0;
            const writes: Promise<unknown>[] = [];
            for (const doc of rows.docs) {
              const r = doc.data() as JobRow, patch: Record<string, unknown> = {};
              if (r.renderStatus === "failed") patch.renderStatus = "pending";
              if (r.internalStatus === "failed") patch.internalStatus = "pending";
              if (r.emailStatus === "failed" || (data.retryUnknownEmail && ["unknown", "sending"].includes(r.emailStatus))) patch.emailStatus = "pending";
              if (Object.keys(patch).length) { patch.processed = false; patch.lastError = ""; writes.push(writer.update(doc.ref, patch)); }
              else if (r.processed) { processed++; if (["unknown", "skipped"].includes(r.emailStatus)) failed++; }
            }
            await Promise.all([writer.close(), Promise.all(writes)]);
            await ref.update({ status: "queued", processedRows: processed, failedRows: failed, nextAttemptAt: 0, leaseExpiresAt: 0, updatedAt: Date.now(), lastError: "" });
          } catch (error) { await ref.update({ status: "failed", lastError: "Retry preparation failed; try again." }); throw error; }
          await advanceJob(job.id, user.id);
        }
        return json({ ok: true });
      }
    }
    if (path[0] === "templates" && method === "GET") {
      if (path.length === 2) {
        const ref = firestore().collection("certificateTemplates").doc(path[1]), doc = await ref.get();
        if (!doc.exists || doc.get("ownerId") !== user.id) throw new ApiError("Template not found", 404);
        const rev = await ref.collection("revisions").doc(doc.get("currentRevisionId")).get();
        return json({ title: doc.get("title"), layout: layoutSchema.parse(rev.data()), backgroundAssetId: rev.get("backgroundAssetId") || null });
      }
      const page = await firestore().collection("certificateTemplates").where("ownerId", "==", user.id).orderBy("updatedAt", "desc").limit(30).get();
      return json({ templates: page.docs.map(d => ({ id: d.id, title: d.get("title") })) });
    }
    if (path.length === 1 && method === "PATCH") { const data = z.object({ action: z.enum(["public", "private", "deleted"]) }).parse(await bodyJson(request)); await changeCertificate(path[0], user.id, data.action); return json({ stats: await statsFor(user.id) }); }
    throw new ApiError("Endpoint not found", 404);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "Invalid certificate data" }, { status: 400 });
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "";
    const known = ["Job not found", "Certificate not found", "Background not found", "Certificate upload not found", "You cannot issue certificates for that event", "Request key reused with different data", "Upload key already used for another certificate"];
    if (known.includes(message)) return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
    console.error("Certificate API request failed", { code: (error as { code?: string }).code || "unavailable" });
    return Response.json({ error: "Certificate storage is unavailable. Check Firebase configuration and certificate indexes." }, { status: 503 });
  }
}
