import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { removeEventAdmin } from "@/lib/event-store";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; userId: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const creatorId = await authenticatedUserId(request);
  if (!creatorId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id, userId } = await params;
  const result = await removeEventAdmin(id, creatorId, userId);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
