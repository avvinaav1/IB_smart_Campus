import type { NextRequest } from "next/server";
import { getEventAttendeeUsers } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { checkInEventAttendee } from "@/lib/event-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const managerId = await authenticatedUserId(request);
  if (!managerId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code : "";
  const { id } = await params;
  const result = await checkInEventAttendee(id, managerId, code);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const users = await getEventAttendeeUsers([result.rsvp.userId]);
  const user = users.get(result.rsvp.userId);
  return noStoreJson({ data: { attendee: { rsvpId: result.rsvp.id, userId: result.rsvp.userId, username: user?.username || "Attendee", email: user?.email || "", rsvpStatus: result.rsvp.rsvpStatus, status: result.rsvp.status, checkInCode: result.rsvp.checkInCode, customFormAnswers: result.rsvp.customFormAnswers, checkedInAt: result.rsvp.checkedInAt, checkedInBy: result.rsvp.checkedInBy, createdAt: result.rsvp.createdAt, updatedAt: result.rsvp.updatedAt } } });
}
