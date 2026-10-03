import "server-only";

import { getTransporter } from "@/lib/otp-email";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type CommunityInviteMail = { communityName: string; description: string; inviterName: string; url: string };

export async function sendCommunityInviteEmails(emails: string[], invite: CommunityInviteMail) {
  const from = process.env.AUTH_FROM_EMAIL;
  const client = getTransporter();
  if (!client || !from) {
    if (process.env.NODE_ENV === "production") throw new Error("Email delivery is not configured.");
    for (const email of emails) console.info(`[Smart Campus invite] ${invite.communityName} invite for ${email}: ${invite.url}`);
    return { sent: [] as string[], failed: [] as string[], delivered: false as const };
  }
  const subject = `${invite.inviterName} invited you to ${invite.communityName} on Smart Campus`.replace(/[\r\n]/g, " ");
  const text = `${invite.inviterName} invited you to join ${invite.communityName} on Smart Campus.\n\n${invite.description}\n\nJoin here: ${invite.url}\n\nIf you weren't expecting this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h1 style="font-size:22px">You're invited to ${escapeHtml(invite.communityName)}</h1><p><b>${escapeHtml(invite.inviterName)}</b> invited you to join this community on Smart Campus.</p><p style="color:#6d6878">${escapeHtml(invite.description)}</p><p style="margin:28px 0"><a href="${escapeHtml(invite.url)}" style="background:#6C3BFF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Join the community</a></p><p style="color:#6d6878;font-size:12px">Or open this link: ${escapeHtml(invite.url)}<br>If you weren't expecting this, you can ignore this email.</p></div>`;
  const results = await Promise.allSettled(emails.map((to) => client.sendMail({ from, to, subject, text, html })));
  const sent = emails.filter((_, index) => results[index].status === "fulfilled");
  const failed = emails.filter((_, index) => results[index].status === "rejected");
  for (const result of results) if (result.status === "rejected") console.error("Community invite email failed", result.reason);
  return { sent, failed, delivered: true as const };
}
