import type { NextRequest } from "next/server";
import { getEventAttendeeUsers, getFreshSession } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { addManualWalkIn, listEventRsvpsForManager } from "@/lib/event-store";
import { isGlobalModerator } from "@/lib/moderation-policy";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const session = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The walk-in entry is invalid." }, { status: 400 });
  const { id } = await params;
  const globalModerator = isGlobalModerator(session.appRole);
  const access = await listEventRsvpsForManager(id, session.id, { globalModerator });
  if ("error" in access) return noStoreJson({ error: access.error }, { status: access.status });
  const users = await getEventAttendeeUsers(access.rsvps.map(rsvp => rsvp.userId));
  const checkedInAt = typeof body.checkedInAt === "string" || typeof body.checkedInAt === "number" ? new Date(body.checkedInAt).getTime() : Date.now();
  const result = await addManualWalkIn(id, session.id, {
    name: typeof body.name === "string" ? body.name : "",
    email: typeof body.email === "string" ? body.email : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    institution: typeof body.institution === "string" ? body.institution : undefined,
    studentId: typeof body.studentId === "string" ? body.studentId : undefined,
    checkedInAt,
  }, { globalModerator, registeredEmails: [...users.values()].map(user => user.email) });
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const attendee = {
    rsvpId: result.rsvp.id,
    userId: result.rsvp.userId,
    username: result.rsvp.participantName || "Walk-in attendee",
    email: result.rsvp.participantEmail || "",
    phone: result.rsvp.participantPhone,
    institution: result.rsvp.institution,
    studentId: result.rsvp.studentId,
    registrationSource: result.rsvp.registrationSource,
    rsvpStatus: result.rsvp.rsvpStatus,
    status: result.rsvp.status,
    checkInCode: result.rsvp.checkInCode,
    customFormAnswers: result.rsvp.customFormAnswers,
    checkedInAt: result.rsvp.checkedInAt,
    checkedInBy: result.rsvp.checkedInBy,
    createdAt: result.rsvp.createdAt,
    updatedAt: result.rsvp.updatedAt,
  };
  return noStoreJson({ data: { attendee, event: result.event } }, { status: 201 });
}
