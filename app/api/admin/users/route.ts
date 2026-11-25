import type { NextRequest } from "next/server";
import { listAdminUsers } from "@/lib/auth-store";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const list = listRequest(request.url);
  const invitedBy = (new URL(request.url).searchParams.get("invitedBy") || "").slice(0, 64);
  return noStoreJson({ data: pageItems(await listAdminUsers(list.query, { invitedBy }), list.offset, list.limit) });
}
