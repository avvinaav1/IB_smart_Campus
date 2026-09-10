import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { setCommunityMembership } from "@/lib/community-store";

export const runtime = "nodejs";

async function update(request: NextRequest, context: { params: Promise<{ id: string }> }, joined: boolean) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const result = await setCommunityMembership(id, userId, joined);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return update(request, context, true);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return update(request, context, false);
}
