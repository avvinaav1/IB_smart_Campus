import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { getEventModerationContext } from "@/lib/event-store";
import { cascadeDeleteEvent } from "@/lib/moderation-cascade";
import { requireCommunityModerator, requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function DELETE(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { eventId } = await context.params;
  const event = await getEventModerationContext(eventId);
  if (!event) return noStoreJson({ error: "Event not found." }, { status: 404 });
  const auth = event.communityId
    ? await requireCommunityModerator(request, event.communityId)
    : await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  try {
    const result = await cascadeDeleteEvent(eventId, event.communityId || null);
    if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
    return result.deleted ? noStoreJson({ data: { deleted: { type: "event", id: eventId } } }) : noStoreJson({ error: "Event not found." }, { status: 404 });
  } catch (error) {
    console.error("Event deletion failed", { eventId, error });
    return noStoreJson({ error: "Event deletion did not finish. Retry to complete it safely." }, { status: 503 });
  }
}
