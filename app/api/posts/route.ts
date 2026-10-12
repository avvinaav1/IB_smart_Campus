import type { NextRequest } from "next/server";
import { getSession, incrementUserStreak } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { createPost, listPosts, type NewPostInput, validatePostInput } from "@/lib/post-store";
import { getCommunitySummary, listEffectiveCommunityMemberIds } from "@/lib/community-store";
import { createNotifications } from "@/lib/notification-store";

export const runtime = "nodejs";

async function authenticatedUser(request: NextRequest) {
  return getSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { posts: await listPosts(user.id) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The post body is invalid." }, { status: 400 });
  if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every((image) => typeof image === "string"))) {
    return noStoreJson({ error: "Post images are invalid." }, { status: 400 });
  }

  const rawPoll = Array.isArray(body.poll)
    ? body.poll.filter((item): item is { label: string } => Boolean(item && typeof item === "object" && typeof (item as { label?: unknown }).label === "string"))
    : undefined;

  const input: NewPostInput = {
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
    communityId: typeof body.communityId === "string" ? body.communityId : "",
    flair: typeof body.flair === "string" ? body.flair : undefined,
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : undefined,
    images: Array.isArray(body.images) && body.images.every((image) => typeof image === "string") ? body.images : undefined,
    poll: rawPoll && rawPoll.length > 0 ? rawPoll.map((item) => ({ label: String(item.label).trim(), percent: 0, votes: 0 })) : undefined,
    pollEndsAt: typeof body.pollEndsAt === "number" && Number.isFinite(body.pollEndsAt) ? body.pollEndsAt : undefined,
  };
  const validationError = validatePostInput(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const result = await createPost(user.id, user.username, input);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: 400 });
  if (result.created) {
    try {
      const [community, memberIds] = await Promise.all([
        getCommunitySummary(result.post.communityId),
        listEffectiveCommunityMemberIds(result.post.communityId),
      ]);
      await Promise.all([
        incrementUserStreak(user.id, "POST_CREATE", String(result.post.id)),
        createNotifications(memberIds.filter((recipientId) => recipientId !== user.id).map((recipientId) => ({
          recipientId,
          senderId: user.id,
          type: "POST" as const,
          content: `${user.username} posted “${result.post.title}” in ${community?.name || result.post.community}.`,
          link: `/?view=explore&community=${encodeURIComponent(result.post.communityId)}`,
          dedupeKey: `post-created:${result.post.id}`,
        }))),
      ]);
    } catch (error) {
      console.error("Post activity side effects failed", error);
    }
  }
  return noStoreJson({ data: result }, { status: 201 });
}
