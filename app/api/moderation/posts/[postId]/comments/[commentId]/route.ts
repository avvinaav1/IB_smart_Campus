import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { requireCommunityModerator } from "@/lib/moderation-auth";
import { deletePostComment, getPostModerationContext } from "@/lib/post-store";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{ postId: string; commentId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { postId: raw, commentId } = await context.params;
  const postId = Number(raw);
  if (!Number.isSafeInteger(postId) || postId <= 0) return noStoreJson({ error: "Post not found." }, { status: 404 });
  const post = await getPostModerationContext(postId);
  if (!post) return noStoreJson({ error: "Post not found." }, { status: 404 });
  const auth = await requireCommunityModerator(request, post.communityId);
  if ("response" in auth) return auth.response;
  const result = await deletePostComment(postId, commentId, post.communityId);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: { deleted: { type: "comment", id: commentId } } });
}
