import type { NextRequest } from "next/server";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { requireGlobalModerator } from "@/lib/moderation-auth";
import { listAdminPosts } from "@/lib/post-store";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const list = listRequest(request.url);
  return noStoreJson({ data: pageItems(await listAdminPosts(list.query), list.offset, list.limit) });
}
