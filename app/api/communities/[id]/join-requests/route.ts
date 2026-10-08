import type { NextRequest } from "next/server";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { listJoinRequestsForCommunity } from "@/lib/community-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await authenticatedUserId(request);
    if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
    const { id } = await context.params;
    const requests = await listJoinRequestsForCommunity(id, userId);
    return noStoreJson({ data: { requests } });
  } catch (error) {
    console.error("listJoinRequestsForCommunity failed", error);
    return noStoreJson({ error: "Could not load requests." }, { status: 500 });
  }
}