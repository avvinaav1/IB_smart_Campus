import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { cascadeDeleteCommunity } from "@/lib/moderation-cascade";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{ communityId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const { communityId } = await context.params;
  try {
    const result = await cascadeDeleteCommunity(communityId);
    return result.deleted ? noStoreJson({ data: { deleted: { type: "community", id: communityId, communityIds: result.communityIds } } }) : noStoreJson({ error: "Community not found." }, { status: 404 });
  } catch (error) {
    console.error("Community deletion failed", { communityId, error });
    return noStoreJson({ error: "Community deletion did not finish. Retry to complete it safely." }, { status: 503 });
  }
}
