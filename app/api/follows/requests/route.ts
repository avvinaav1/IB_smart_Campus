import type { NextRequest } from "next/server";
import { getDirectoryUsers } from "@/lib/auth-store";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { listIncomingFollowRequests } from "@/lib/social-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const requests = await listIncomingFollowRequests(userId);
  const senders = await getDirectoryUsers(requests.map((item) => item.followerId));
  return noStoreJson({ data: { requests: requests.flatMap((item) => {
    const sender = senders.get(item.followerId);
    return sender ? [{ id: item.id, sender: { id: sender.id, username: sender.username, avatarUrl: sender.avatarUrl, isPrivate: sender.isPrivate }, createdAt: item.createdAt }] : [];
  }) } });
}
