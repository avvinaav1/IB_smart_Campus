import type { NextRequest } from "next/server";
import { handleCertificates } from "@/lib/certificates/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Job creation, retry, and status polls each claim and run one bounded chunk
// of certificate processing inline (see JOB_CHUNK_BUDGET_MS in lib/certificates/api.ts)
// since a serverless deployment has no separate always-on worker process.
// 60s is the ceiling on Vercel's Hobby plan; raise it if your plan allows more.
export const maxDuration = 60;
async function handle(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handleCertificates(request, (await context.params).path || []);
}
export { handle as GET, handle as POST, handle as PATCH };
