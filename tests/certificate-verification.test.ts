import test from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { reserveVerification, activateVerification, lookupVerification, generateVerificationCode } from "../lib/certificates/verification-store";
import { verificationQuota, verificationClientKey, nextVerificationQuota } from "../lib/certificates/verification-limit";
import { validVerificationCode, publicVerification } from "../lib/certificates/verification-code";
import { verificationResponse } from "../lib/certificates/verification-api";
import { INITIAL_LAYOUT, jobInputSchema, effectiveElements, substitute, type JobRecord, type JobRow } from "../lib/certificates/model";
import { parseAttendeeFile } from "../lib/certificates/import-file";
import { renderPng } from "../lib/certificates/node-render";
import { internalAward } from "../lib/certificates/store";

type Data = Record<string, unknown>;
// Transaction double with atomic commits and serialized concurrent callers.
// Live Firestore rules/SDK integration still require a configured staging project.
function database() {
  const documents = new Map<string, Data>();
  function ref(path: string): { path: string; id: string; collection: (name: string) => { doc: (id: string) => ReturnType<typeof ref> }; get: () => Promise<ReturnType<typeof snapshot>> } {
    return { path, id: path.split("/").at(-1)!, collection: name => ({ doc: id => ref(`${path}/${name}/${id}`) }), get: async () => snapshot(ref(path)) };
  }
  function snapshot(r: ReturnType<typeof ref>) { const data = documents.get(r.path); return { exists: !!data, ref: r, get: (field: string) => data?.[field], data: () => data }; }
  let tail: Promise<unknown> = Promise.resolve();
  const adapter = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: <T>(fn: (tx: { get: (r: ReturnType<typeof ref>) => Promise<ReturnType<typeof snapshot>>; create: (r: ReturnType<typeof ref>, data: Data) => void; update: (r: ReturnType<typeof ref>, data: Data) => void; set: (r: ReturnType<typeof ref>, data: Data) => void }) => Promise<T>) => {
      const run = tail.then(async () => {
        const writes: (() => void)[] = [];
        const result = await fn({ get: async r => snapshot(r), create: (r, data) => { assert.equal(documents.has(r.path), false); writes.push(() => documents.set(r.path, data)); }, update: (r, data) => { assert.ok(documents.has(r.path)); writes.push(() => documents.set(r.path, { ...documents.get(r.path), ...data })); }, set: (r, data) => { writes.push(() => documents.set(r.path, data)); } });
        writes.forEach(write => write()); return result;
      });
      tail = run.catch(() => undefined); return run;
    },
  };
  return { db: adapter as unknown as Firestore, documents };
}
const code = "7K3M9P2R8V4X", secondCode = "8K3M9P2R8V4X";
const job = { id: "job-one", status: "running", leaseToken: "lease", leaseExpiresAt: Date.now() + 120_000, title: "Design workshop", organizerId: "organizer", issuerName: "IB Events", columnMapping: { displayName: "name", email: "email" }, requestedActions: { archive: true, email: true, internalDelivery: true }, emailTemplate: { subject: "Certificate", text: "Hello" } } as JobRecord;
const row: JobRow = { id: "000001", rowNumber: 1, values: { name: "Priya Patel", course: "Design", email: "priya@example.test" }, overrides: {}, renderStatus: "pending", matchStatus: "unmatched", internalStatus: "pending", emailStatus: "pending", emailAttempts: 0, createdAt: 0, updatedAt: 0 };
function seeded() { const state = database(); state.documents.set("certificateJobs/job-one", { ...job, leaseExpiresAt: Date.now() + 120_000 }); state.documents.set("certificateJobs/job-one/rows/000001", { ...row }); return state; }

test("Nano ID produces 12-character codes in the unambiguous 32-symbol alphabet", () => {
  const codes = Array.from({ length: 10_000 }, () => generateVerificationCode());
  assert.equal(new Set(codes).size, codes.length); assert.ok(codes.every(validVerificationCode));
});
test("reservation retries collisions, pins one code across concurrent retries, activates only after rendering", async () => {
  const { db, documents } = seeded();
  documents.set(`certificateVerificationCodes/${code}`, { certificateId: "another-certificate" });
  let calls = 0;
  const [first, retry] = await Promise.all([reserveVerification(db, job, row, () => ++calls === 1 ? code : secondCode), reserveVerification(db, job, row, () => secondCode)]);
  assert.equal(first.verificationCode, secondCode); assert.deepEqual(first, retry);
  assert.equal(await lookupVerification(db, secondCode), null);
  const issued = { ...row, ...first };
  await activateVerification(db, job, issued, "png-asset");
  const details = await lookupVerification(db, secondCode);
  assert.equal(details?.recipientName, "Priya Patel"); assert.equal(details?.courseName, "Design");
  assert.equal(details?.issuerName, "IB Events"); assert.ok(details?.issuedAt);
  assert.equal(documents.get(`certificates/${first.certificateId}`)?.userId, undefined);
  assert.equal(documents.get(`certificates/${first.certificateId}`)?.profileAwarded, false);
  await activateVerification(db, job, issued, "png-asset");
  assert.deepEqual(await lookupVerification(db, secondCode), details);
  assert.deepEqual(Object.keys(details!).sort(), ["courseName", "issuedAt", "issuerName", "recipientName", "verificationCode"]);
  documents.get(`certificates/${first.certificateId}`)!.status = "deleted";
  assert.equal(await lookupVerification(db, secondCode), null);
});
test("expired leases cannot reserve or activate a certificate", async () => {
  const { db, documents } = seeded();
  documents.get("certificateJobs/job-one")!.leaseExpiresAt = 0;
  await assert.rejects(reserveVerification(db, job, row), /lease lost/);
  assert.equal(documents.size, 2);
});
test("issued records become one profile award and inbox message across retries", async () => {
  const { db, documents } = seeded();
  const reserved = await reserveVerification(db, job, row, () => code);
  const issued = { ...row, ...reserved, matchedUserId: "recipient", assetId: "png-asset" };
  await activateVerification(db, job, issued, issued.assetId);
  await internalAward(job, issued, job.leaseToken, db);
  await internalAward(job, issued, job.leaseToken, db);
  assert.equal(documents.get("certificateProfiles/recipient")?.certificateCount, 1);
  assert.equal(documents.get("certificateProfiles/recipient")?.internalCount, 1);
  assert.equal(documents.get(`certificates/${reserved.certificateId}`)?.verificationCode, code);
  assert.equal(documents.get(`certificates/${reserved.certificateId}`)?.userId, "recipient");
  assert.equal([...documents.keys()].filter(path => path.startsWith("certificateInboxes/")).length, 1);
});
test("CSV and client payloads cannot choose verification codes; renderer uses the server value", async () => {
  const imported = await parseAttendeeFile(new File([`name,email,course,verification_code\nPriya,p@example.test,Design,${secondCode}`], "attendees.csv"));
  assert.ok(!imported.headers.includes("verification_code"));
  assert.equal(substitute("{{verification_code}}", { verification_code: secondCode }), "PREVIEW ONLY");
  assert.equal(substitute("{{verification_code}}", { verification_code: secondCode }, code), code);
  assert.ok(effectiveElements(INITIAL_LAYOUT, { ...row, verificationCode: code }).some(e => e.text.includes(code)));
  const input = { ...job, layout: INITIAL_LAYOUT, rows: [row], headers: ["name", "email", "course"], allowDistinctAwards: false };
  assert.equal(jobInputSchema.safeParse(input).success, true);
  assert.equal(jobInputSchema.safeParse({ ...input, headers: [...input.headers, "verification_code"] }).success, false);
  assert.equal(jobInputSchema.safeParse({ ...input, rows: [{ ...row, overrides: { "text-5": { text: "Hidden" } } }] }).success, false);
  const plain = await renderPng(INITIAL_LAYOUT, row);
  const marked = await renderPng(INITIAL_LAYOUT, { ...row, verificationCode: code });
  assert.notDeepEqual(marked, plain);
  assert.equal(publicVerification({ source: "external", status: "active", verificationCode: code }, code), null);
});
test("shared quotas enforce concurrent requests and reset after a minute", async () => {
  const { db } = database();
  const limits = await Promise.all(Array.from({ length: 25 }, () => verificationQuota(db, "test-client")));
  assert.equal(limits.filter(limit => limit.allowed).length, 20);
  assert.ok(limits.filter(limit => !limit.allowed).every(limit => limit.retryAfter > 0));
  assert.equal(nextVerificationQuota({ start: 100, count: 20 }, 20, 60100).allowed, true);
  const old = process.env.CERTIFICATE_CLIENT_IP_HEADER;
  delete process.env.CERTIFICATE_CLIENT_IP_HEADER;
  try { assert.equal(verificationClientKey(new Headers({ "x-forwarded-for": "1.2.3.4" })), "shared"); } finally { if (old !== undefined) process.env.CERTIFICATE_CLIENT_IP_HEADER = old; }
});
test("public API returns valid, invalid, rate limited and unavailable states without leaking errors", async () => {
  const allowed = async () => ({ allowed: true, retryAfter: 0 });
  const details = { verificationCode: code, recipientName: "Priya", courseName: "Design", issuerName: "IB Events", issuedAt: 1700000000000 };
  const valid = await verificationResponse(code.toLowerCase(), allowed, async value => { assert.equal(value, code); return details; });
  assert.equal(valid.status, 200); assert.equal(valid.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await valid.json(), { valid: true, certificate: details });
  assert.equal((await verificationResponse(code, allowed, async () => null)).status, 404);
  assert.equal((await verificationResponse("bad", allowed, async () => { throw new Error("must not lookup"); })).status, 404);
  const limited = await verificationResponse(code, async () => ({ allowed: false, retryAfter: 42 }), async () => { throw new Error("must not lookup"); });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "42");
  const failed = await verificationResponse(code, async () => { throw new Error("private database details"); }, async () => details);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes("private database"));
});
