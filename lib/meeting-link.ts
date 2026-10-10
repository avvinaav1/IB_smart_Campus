import "server-only";

const MEET_BASE_URL = (process.env.MEET_API_URL || "https://meet.icebrkr.space").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 10_000;

export type GeneratedMeeting = { roomCode: string; meetingLink: string; time: string };

/**
 * Creates a room on the ICEBRKR Meet service for an event. `startsAt` is any
 * ISO-8601 timestamp; the service echoes it back in UTC.
 */
export async function createMeetingLink(title: string, startsAt: string): Promise<GeneratedMeeting> {
  const apiKey = process.env.MEET_API_KEY;
  if (!apiKey) throw new Error("Meeting links are not configured on this server.");
  const response = await fetch(`${MEET_BASE_URL}/api/external/meetings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, time: startsAt }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  const result = await response.json().catch(() => null) as { room_code?: unknown; meeting_link?: unknown; time?: unknown } | null;
  if (!response.ok || typeof result?.meeting_link !== "string") {
    console.error("Meeting link creation failed", response.status, result);
    throw new Error("The meeting service could not create a link. Try again in a moment.");
  }
  // Only accept links on the meeting service itself, never an arbitrary URL from the response.
  const link = new URL(result.meeting_link);
  if (link.origin !== new URL(MEET_BASE_URL).origin) throw new Error("The meeting service returned an unexpected link.");
  return { roomCode: typeof result.room_code === "string" ? result.room_code : "", meetingLink: link.toString(), time: typeof result.time === "string" ? result.time : startsAt };
}
