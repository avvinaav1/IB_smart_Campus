import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { getDirectoryUsers } from "@/lib/auth-store";
import { callMessageBody } from "@/lib/chat-call";
import { createMeetingLink } from "@/lib/meeting-link";
import { createNotifications } from "@/lib/notification-store";
import { getConversationMemberIds, sendConversationMessage } from "@/lib/social-store";

export const runtime = "nodejs";

/** Starts an immediate call: creates a "<user> & <user>'s meeting" room and posts its link into the chat. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const memberIds = await getConversationMemberIds(id, userId);
  if (!memberIds) return noStoreJson({ error: "Conversation not found." }, { status: 404 });

  const users = await getDirectoryUsers(memberIds);
  // Caller first, then the other person.
  const names = [userId, ...memberIds.filter((memberId) => memberId !== userId)].map((memberId) => users.get(memberId)?.username).filter(Boolean);
  const title = `${names.join(" & ") || "Smart Campus"}'s meeting`.slice(0, 90);

  let meetingLink: string;
  try {
    meetingLink = (await createMeetingLink(title, new Date().toISOString())).meetingLink;
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Could not start the call." }, { status: 502 });
  }
  const result = await sendConversationMessage(id, userId, callMessageBody(meetingLink));
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  if (result.recipientId) {
    try {
      // Also pushed to the recipient's devices; tapping it opens the room directly.
      await createNotifications({ recipientId: result.recipientId, senderId: userId, type: "MESSAGE", content: `${users.get(userId)?.username || "Someone"} is calling you. Tap to join.`, link: meetingLink, dedupeKey: `call:${result.message.id}` });
    } catch (error) {
      console.error("Call notification failed", error);
    }
  }
  return noStoreJson({ data: { meetingLink, title, message: result.message } }, { status: 201 });
}
