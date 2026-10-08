import type { NextRequest } from "next/server";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { listJoinRequestsForOwner } from "@/lib/community-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const requests = await listJoinRequestsForOwner(userId);
  return noStoreJson({ data: { requests } });
}