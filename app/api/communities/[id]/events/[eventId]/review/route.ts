import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { reviewCommunityEvent } from "@/lib/event-store";
import { requireCommunityEventApprover } from "@/lib/moderation-auth";
import { getCommunitySummary, listEffectiveCommunityMemberIds } from "@/lib/community-store";
import { createNotifications } from "@/lib/notification-store";

export const runtime = "nodejs";
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; eventId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { id: communityId, eventId } = await context.params;
  const auth = await requireCommunityEventApprover(request, communityId);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body?.status !== "APPROVED" && body?.status !== "REJECTED") return noStoreJson({ error: "Choose APPROVED or REJECTED." }, { status: 400 });
  const result = await reviewCommunityEvent(communityId, eventId, auth.user.id, body.status);
  if (!("error" in result) && body.status === "APPROVED") {
    try {
      const [community, memberIds] = await Promise.all([
        getCommunitySummary(communityId),
        listEffectiveCommunityMemberIds(communityId),
      ]);
      await createNotifications(memberIds.filter((recipientId) => recipientId !== auth.user.id).map((recipientId) => ({
        recipientId,
        senderId: auth.user.id,
        type: "EVENT" as const,
        content: `${result.event.title} was approved in ${community?.name || "your community"}.`,
        link: "/?view=events",
        dedupeKey: `event-approved:${result.event.id}`,
      })));
    } catch (error) {
      console.error("Event-approval notification fan-out failed", error);
    }
  }
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
