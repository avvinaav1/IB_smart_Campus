import type { NextRequest } from "next/server";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { listAdminEvents } from "@/lib/event-store";
import { requireGlobalModerator } from "@/lib/moderation-auth";
import type { EventStatus } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const list = listRequest(request.url);
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(list.status) ? list.status as EventStatus : undefined;
  return noStoreJson({ data: pageItems(await listAdminEvents(list.query, status), list.offset, list.limit) });
}
