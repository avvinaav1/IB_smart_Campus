import type { NextRequest } from "next/server";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { listAdminCommunities } from "@/lib/community-store";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const list = listRequest(request.url);
  return noStoreJson({ data: pageItems(await listAdminCommunities(list.query), list.offset, list.limit) });
}
