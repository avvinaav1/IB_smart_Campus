/** Chat messages that announce a call look like this, so anything that does not render the call card still shows a readable link. */
export const CALL_MESSAGE_PREFIX = "Started a video call: ";
const MEET_ORIGIN = new URL(process.env.NEXT_PUBLIC_MEET_URL || "https://meet.icebrkr.space").origin;

export function callMessageBody(meetingLink: string) {
  return `${CALL_MESSAGE_PREFIX}${meetingLink}`;
}

/** The meeting link if `body` is a call announcement, else null. */
export function parseCallMessage(body: string) {
  if (!body.startsWith(CALL_MESSAGE_PREFIX)) return null;
  const link = body.slice(CALL_MESSAGE_PREFIX.length).trim();
  // Only links on the meeting service get the Join card; anything else someone types stays a plain message.
  try { return /^\S+$/.test(link) && new URL(link).origin === MEET_ORIGIN ? link : null; }
  catch { return null; }
}
