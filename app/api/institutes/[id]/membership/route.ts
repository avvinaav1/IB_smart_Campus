import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { requireAuthenticatedUser } from "@/lib/moderation-auth";
import { joinInstitute, leaveInstitute } from "@/lib/institute-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireAuthenticatedUser(request); if ("response" in auth) return auth.response;
  const { id } = await context.params; const result = await joinInstitute(id, auth.user.id);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: result.alreadyJoined ? 200 : 201 });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireAuthenticatedUser(request); if ("response" in auth) return auth.response;
  const { id } = await context.params; const result = await leaveInstitute(id, auth.user.id);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
