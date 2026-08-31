import type { NextRequest } from "next/server";
import { getEventAttendeeUsers } from "@/lib/auth-store";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { listEventRsvpsForManager } from "@/lib/event-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const result = await listEventRsvpsForManager(id, userId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const users = await getEventAttendeeUsers(result.rsvps.map((rsvp) => rsvp.userId));
  const attendees = result.rsvps.flatMap((rsvp) => {
    const user = users.get(rsvp.userId);
    return user ? [{ rsvpId: rsvp.id, userId: user.id, username: user.username, email: user.email, rsvpStatus: rsvp.rsvpStatus, status: rsvp.status, checkInCode: rsvp.checkInCode, customFormAnswers: rsvp.customFormAnswers, checkedInAt: rsvp.checkedInAt, checkedInBy: rsvp.checkedInBy, createdAt: rsvp.createdAt, updatedAt: rsvp.updatedAt }] : [];
  });
  return noStoreJson({ data: { attendees, customFormSchema: result.event.customFormSchema, isCreator: result.isCreator } });
}
