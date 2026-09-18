import type { NextRequest } from "next/server";
import { getEventAttendeeUsers } from "@/lib/auth-store";
import { noStoreJson } from "@/lib/auth-http";
import { getAdminEvent } from "@/lib/event-store";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ eventId: string }> }) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const { eventId } = await context.params;
  const result = await getAdminEvent(eventId);
  if (!result) return noStoreJson({ error: "Event not found." }, { status: 404 });
  const users = await getEventAttendeeUsers(result.rsvps.map((rsvp) => rsvp.userId));
  const attendees = result.rsvps.map((rsvp) => ({ ...rsvp, username: rsvp.participantName || users.get(rsvp.userId)?.username || "Deleted user", email: rsvp.participantEmail || users.get(rsvp.userId)?.email || "", phone: rsvp.participantPhone, institution: rsvp.institution, studentId: rsvp.studentId, registrationSource: rsvp.registrationSource }));
  return noStoreJson({ data: { event: result.event, attendees } });
}
