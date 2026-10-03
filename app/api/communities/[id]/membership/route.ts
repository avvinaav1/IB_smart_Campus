import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { incrementUserStreak } from "@/lib/auth-store";
import { setCommunityMembership } from "@/lib/community-store";

export const runtime = "nodejs";

async function update(request: NextRequest, context: { params: Promise<{ id: string }> }, joined: boolean) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const body = joined ? await readJson(request) : null;
  const inviteToken = typeof body?.inviteToken === "string" ? body.inviteToken.trim().slice(0, 64) : "";
  const result = await setCommunityMembership(id, userId, joined, inviteToken);
  if (!("error" in result) && joined && result.changed) {
    try { await incrementUserStreak(userId, "COMMUNITY_JOIN", id); }
    catch (error) { console.error("Community-join streak update failed", error); }
  }
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return update(request, context, true);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return update(request, context, false);
}
