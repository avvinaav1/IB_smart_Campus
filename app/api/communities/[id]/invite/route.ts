import type { NextRequest } from "next/server";
import { getDirectoryUser, getDirectoryUsers, isValidEmail, normalizeEmail } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { sendCommunityInviteEmails } from "@/lib/community-invite-email";
import { communityInvitePath } from "@/lib/community-invite-link";
import { getCommunityInvite, listEffectiveCommunityMemberIds } from "@/lib/community-store";
import { createNotifications } from "@/lib/notification-store";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

const MAX_INVITES_PER_REQUEST = 20;

/** Invite link for admins/moderators. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const result = await getCommunityInvite(id, userId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  return noStoreJson({ data: { url: `${SITE_URL}${communityInvitePath(id, result.token)}` } });
}

/** Body: `{ rotate: true }` to reset the link, `{ userIds: [...] }` to notify members, or `{ emails: [...] }` to email the link. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The invite body is invalid." }, { status: 400 });
  const result = await getCommunityInvite(id, userId, body.rotate === true);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const path = communityInvitePath(id, result.token);
  const url = `${SITE_URL}${path}`;
  if (body.rotate === true) return noStoreJson({ data: { url } });

  const inviter = await getDirectoryUser(userId);
  const inviterName = inviter?.username || "A community admin";

  if (Array.isArray(body.userIds)) {
    const requested = [...new Set(body.userIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())))];
    if (!requested.length || requested.length > MAX_INVITES_PER_REQUEST) return noStoreJson({ error: `Choose 1–${MAX_INVITES_PER_REQUEST} people to invite.` }, { status: 400 });
    const [users, memberIds] = await Promise.all([getDirectoryUsers(requested), listEffectiveCommunityMemberIds(id)]);
    const members = new Set(memberIds);
    const recipients = requested.filter((recipientId) => users.has(recipientId) && !members.has(recipientId) && recipientId !== userId);
    await createNotifications(recipients.map((recipientId) => ({
      recipientId,
      senderId: userId,
      type: "COMMUNITY" as const,
      content: `${inviterName} invited you to join ${result.community.name}.`,
      link: path,
      dedupeKey: `community-invite:${id}:${result.token}`,
    })));
    return noStoreJson({ data: { invited: recipients.length, skipped: requested.length - recipients.length } });
  }

  if (Array.isArray(body.emails)) {
    const emails = [...new Set(body.emails.filter((value): value is string => typeof value === "string").map(normalizeEmail).filter(Boolean))];
    if (!emails.length || emails.length > MAX_INVITES_PER_REQUEST) return noStoreJson({ error: `Enter 1–${MAX_INVITES_PER_REQUEST} email addresses.` }, { status: 400 });
    const invalid = emails.filter((email) => !isValidEmail(email));
    if (invalid.length) return noStoreJson({ error: `Check these email addresses: ${invalid.slice(0, 3).join(", ")}` }, { status: 400 });
    try {
      const sent = await sendCommunityInviteEmails(emails, { communityName: result.community.name, description: result.community.description, inviterName, url });
      if (sent.delivered && !sent.sent.length) return noStoreJson({ error: "The invite emails could not be sent. Try again later." }, { status: 502 });
      return noStoreJson({ data: { invited: sent.delivered ? sent.sent.length : emails.length, failed: sent.failed } });
    } catch (error) {
      return noStoreJson({ error: error instanceof Error ? error.message : "The invite emails could not be sent." }, { status: 502 });
    }
  }

  return noStoreJson({ error: "Choose people or email addresses to invite." }, { status: 400 });
}
