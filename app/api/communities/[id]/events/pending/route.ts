import type { NextRequest } from "next/server";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { listPendingCommunityEvents } from "@/lib/event-store";
import { requireCommunityEventApprover } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: communityId } = await context.params;
  const auth = await requireCommunityEventApprover(request, communityId);
  if ("response" in auth) return auth.response;
  const list = listRequest(request.url);
  const normalized = list.query.toLowerCase();
  const events = (await listPendingCommunityEvents(communityId, auth.user.id))
    .filter((event) => !normalized || event.title.toLowerCase().includes(normalized) || event.venueName.toLowerCase().includes(normalized));
  return noStoreJson({ data: pageItems(events, list.offset, list.limit) });
}
