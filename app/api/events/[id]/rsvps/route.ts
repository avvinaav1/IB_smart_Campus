import type { NextRequest } from "next/server";
import { getEventAttendeeUsers, getFreshSession } from "@/lib/auth-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";
import { listEventRsvpsForManager } from "@/lib/event-store";
import { isGlobalModerator } from "@/lib/moderation-policy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const result = await listEventRsvpsForManager(id, session.id, { globalModerator: isGlobalModerator(session.appRole) });
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const users = await getEventAttendeeUsers(result.rsvps.map((rsvp) => rsvp.userId));
  const attendees = result.rsvps.flatMap((rsvp) => {
    const user = users.get(rsvp.userId);
    if (!user && rsvp.registrationSource !== "MANUAL_WALK_IN") return [];
    return [{ rsvpId: rsvp.id, userId: user?.id || rsvp.userId, username: rsvp.participantName || user?.username || "Walk-in attendee", email: rsvp.participantEmail || user?.email || "", phone: rsvp.participantPhone, institution: rsvp.institution, studentId: rsvp.studentId, registrationSource: rsvp.registrationSource, rsvpStatus: rsvp.rsvpStatus, status: rsvp.status, checkInCode: rsvp.checkInCode, customFormAnswers: rsvp.customFormAnswers, checkedInAt: rsvp.checkedInAt, checkedInBy: rsvp.checkedInBy, createdAt: rsvp.createdAt, updatedAt: rsvp.updatedAt }];
  });
  return noStoreJson({ data: { attendees, customFormSchema: result.event.customFormSchema, isCreator: result.isCreator } });
}
