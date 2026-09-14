import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { cascadeDeletePost } from "@/lib/moderation-cascade";
import { requireCommunityModerator } from "@/lib/moderation-auth";
import { getPostModerationContext } from "@/lib/post-store";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{ postId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { postId: raw } = await context.params;
  const postId = Number(raw);
  if (!Number.isSafeInteger(postId) || postId <= 0) return noStoreJson({ error: "Post not found." }, { status: 404 });
  const post = await getPostModerationContext(postId);
  if (!post) return noStoreJson({ error: "Post not found." }, { status: 404 });
  const auth = await requireCommunityModerator(request, post.communityId);
  if ("response" in auth) return auth.response;
  const result = await cascadeDeletePost(postId, post.communityId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  return result.deleted ? noStoreJson({ data: { deleted: { type: "post", id: raw } } }) : noStoreJson({ error: "Post not found." }, { status: 404 });
}
