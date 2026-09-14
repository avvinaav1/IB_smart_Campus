import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { setCommunityMemberRole } from "@/lib/community-store";
import { requireCommunityAdmin } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; userId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { id: communityId, userId } = await context.params;
  const auth = await requireCommunityAdmin(request, communityId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body?.communityRole !== "MEMBER" && body?.communityRole !== "COMMUNITY_MODERATOR") return noStoreJson({ error: "Choose MEMBER or COMMUNITY_MODERATOR." }, { status: 400 });
  const result = await setCommunityMemberRole(communityId, auth.user.id, userId, body.communityRole);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
