import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { createMeetingLink } from "@/lib/meeting-link";

export const runtime = "nodejs";

/** Body: `{ title, startsAt }` → `{ meetingLink, roomCode }` for the event being created or edited. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const startsAt = typeof body?.startsAt === "string" ? new Date(body.startsAt) : null;
  if (!title || title.length > 90) return noStoreJson({ error: "Add an event title (up to 90 characters) first." }, { status: 400 });
  if (!startsAt || Number.isNaN(startsAt.getTime())) return noStoreJson({ error: "Choose the event date and time first." }, { status: 400 });
  try {
    const meeting = await createMeetingLink(title, startsAt.toISOString());
    return noStoreJson({ data: { meetingLink: meeting.meetingLink, roomCode: meeting.roomCode } });
  } catch (error) {
    return noStoreJson({ error: error instanceof Error ? error.message : "Could not create a meeting link." }, { status: 502 });
  }
}
