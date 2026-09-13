import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { incrementUserStreak } from "@/lib/auth-store";
import { sendConversationMessage } from "@/lib/social-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const message = typeof body?.message === "string" ? body.message : "";
  const { id } = await context.params;
  const result = await sendConversationMessage(id, userId, message);
  if (!("error" in result)) {
    try { await incrementUserStreak(userId, "CHAT_MESSAGE", result.message.id); }
    catch (error) { console.error("Chat-message streak update failed", error); }
  }
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: 201 });
}
