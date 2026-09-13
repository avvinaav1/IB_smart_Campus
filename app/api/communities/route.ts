import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { createCommunity, listCommunities, type CommunityPrivacy, type NewCommunityInput, validateCommunityInput } from "@/lib/community-store";
import type { CommunityType } from "@/lib/types";
import { getDirectoryUser } from "@/lib/auth-store";
import { listFollowerIds } from "@/lib/social-store";
import { createNotifications } from "@/lib/notification-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { communities: await listCommunities(userId) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The community body is invalid." }, { status: 400 });
  if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== "string") {
    return noStoreJson({ error: "Choose a valid parent community." }, { status: 400 });
  }
  const input: NewCommunityInput = {
    name: typeof body.name === "string" ? body.name : "",
    type: typeof body.type === "string" ? body.type as CommunityType : "" as CommunityType,
    parentId: typeof body.parentId === "string" ? body.parentId.trim() : null,
    description: typeof body.description === "string" ? body.description : "",
    color: typeof body.color === "string" ? body.color : "",
    emoji: typeof body.emoji === "string" ? body.emoji : "",
    privacy: typeof body.privacy === "string" ? body.privacy as CommunityPrivacy : "public",
  };
  const validationError = validateCommunityInput(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const result = await createCommunity(userId, input);
  if (!("error" in result)) {
    try {
      const [creator, followerIds] = await Promise.all([getDirectoryUser(userId), listFollowerIds(userId)]);
      await createNotifications(followerIds.filter((recipientId) => recipientId !== userId).map((recipientId) => ({
        recipientId,
        senderId: userId,
        type: "COMMUNITY" as const,
        content: `${creator?.username || "Someone you follow"} created ${result.community.name}.`,
        link: `/?view=explore&community=${encodeURIComponent(result.community.id)}`,
        dedupeKey: `community-created:${result.community.id}`,
      })));
    } catch (error) {
      console.error("Community notification fan-out failed", error);
    }
  }
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: 201 });
}
