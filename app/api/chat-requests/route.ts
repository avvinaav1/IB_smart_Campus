import type { NextRequest } from "next/server";
import { getDirectoryUser, getDirectoryUsers } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { createChatRequest, listIncomingChatRequests, validateInitialMessage } from "@/lib/social-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const requests = await listIncomingChatRequests(userId);
  const senders = await getDirectoryUsers(requests.map((item) => item.senderId));
  return noStoreJson({ data: { requests: requests.flatMap((item) => {
    const sender = senders.get(item.senderId);
    return sender ? [{ id: item.id, sender: { id: sender.id, username: sender.username, avatarUrl: sender.avatarUrl, isPrivate: sender.isPrivate }, initialMessage: item.initialMessage, createdAt: item.createdAt }] : [];
  }) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const recipientId = typeof body?.recipientId === "string" ? body.recipientId : "";
  const message = typeof body?.message === "string" ? body.message : "";
  const validationError = validateInitialMessage(message);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const recipient = await getDirectoryUser(recipientId);
  if (!recipient) return noStoreJson({ error: "User not found." }, { status: 404 });
  const result = await createChatRequest(userId, recipient.id, message);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: 201 });
}
