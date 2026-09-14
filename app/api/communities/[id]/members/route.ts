import type { NextRequest } from "next/server";
import { getDirectoryUsers } from "@/lib/auth-store";
import { listRequest, pageItems } from "@/lib/admin-http";
import { noStoreJson } from "@/lib/auth-http";
import { listCommunityMemberRecords } from "@/lib/community-store";
import { requireCommunityAdmin } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: communityId } = await context.params;
  const auth = await requireCommunityAdmin(request, communityId);
  if ("response" in auth) return auth.response;
  const records = await listCommunityMemberRecords(communityId);
  if (!records) return noStoreJson({ error: "Community not found." }, { status: 404 });
  const users = await getDirectoryUsers(records.map((record) => record.userId));
  const list = listRequest(request.url);
  const normalized = list.query.toLowerCase();
  const members = records.flatMap((record) => {
    const user = users.get(record.userId);
    return user && (!normalized || user.username.toLowerCase().includes(normalized)) ? [{ ...record, username: user.username, avatarUrl: user.avatarUrl }] : [];
  });
  return noStoreJson({ data: pageItems(members, list.offset, list.limit) });
}
