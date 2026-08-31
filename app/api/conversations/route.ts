import type { NextRequest } from "next/server";
import { getDirectoryUsers } from "@/lib/auth-store";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { listUserConversations } from "@/lib/social-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const conversations = await listUserConversations(userId);
  const users = await getDirectoryUsers(conversations.map((conversation) => conversation.otherUserId));
  return noStoreJson({ data: { conversations: conversations.flatMap((conversation) => {
    const otherUser = users.get(conversation.otherUserId);
    return otherUser ? [{ id: conversation.id, otherUser: { id: otherUser.id, username: otherUser.username, avatarUrl: otherUser.avatarUrl, isPrivate: otherUser.isPrivate }, messages: conversation.messages, updatedAt: conversation.updatedAt }] : [];
  }) } });
}
