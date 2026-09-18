import type { NextRequest } from "next/server";
import { getEventAttendeeUsers, getFreshSession } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { checkInEventAttendee } from "@/lib/event-store";
import { isGlobalModerator } from "@/lib/moderation-policy";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const session = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const code = typeof body?.code === "string" ? body.code : "";
  const { id } = await params;
  const result = await checkInEventAttendee(id, session.id, code, { globalModerator: isGlobalModerator(session.appRole) });
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const users = await getEventAttendeeUsers([result.rsvp.userId]);
  const user = users.get(result.rsvp.userId);
  return noStoreJson({ data: { attendee: { rsvpId: result.rsvp.id, userId: result.rsvp.userId, username: result.rsvp.participantName || user?.username || "Attendee", email: result.rsvp.participantEmail || user?.email || "", phone: result.rsvp.participantPhone, institution: result.rsvp.institution, studentId: result.rsvp.studentId, registrationSource: result.rsvp.registrationSource, rsvpStatus: result.rsvp.rsvpStatus, status: result.rsvp.status, checkInCode: result.rsvp.checkInCode, customFormAnswers: result.rsvp.customFormAnswers, checkedInAt: result.rsvp.checkedInAt, checkedInBy: result.rsvp.checkedInBy, createdAt: result.rsvp.createdAt, updatedAt: result.rsvp.updatedAt } } });
}
