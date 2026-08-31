import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { cancelEventRsvp, setEventRsvp } from "@/lib/event-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The registration body is invalid." }, { status: 400 });
  const result = await setEventRsvp(id, userId, body.answers);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: result }, { status: result.alreadyExisted ? 200 : 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const result = await cancelEventRsvp(id, userId);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
