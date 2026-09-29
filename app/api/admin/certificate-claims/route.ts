import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/auth-http";
import { listClaims, type ClaimFilter } from "@/lib/certificates/admin-stats";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const filter: ClaimFilter = status === "claimed" || status === "pending" ? status : "all";
  const limit = Math.min(100, Math.max(1, Math.floor(Number(params.get("limit")) || 25)));
  const cursor = params.get("cursor");
  try {
    return noStoreJson({ data: await listClaims(filter, limit, cursor && /^[a-f0-9]{64}$/.test(cursor) ? cursor : undefined) });
  } catch (error) {
    // FAILED_PRECONDITION: the claimed+createdAt composite index isn't deployed yet.
    const missingIndex = (error as { code?: unknown }).code === 9;
    console.error("Certificate claims list failed", { code: (error as { code?: unknown }).code ?? "unavailable" });
    return noStoreJson({ error: missingIndex ? "Deploy the Firestore indexes (firebase deploy --only firestore:indexes) to filter claims." : "Could not load certificate claims." }, { status: missingIndex ? 503 : 500 });
  }
}
