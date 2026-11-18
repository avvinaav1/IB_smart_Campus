import "server-only";

import { getTransporter } from "@/lib/otp-email";
import { SITE_URL } from "@/lib/site";
import type { AppRole } from "@/lib/types";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ROLE_LABELS: Record<AppRole, string> = { USER: "User", APP_MODERATOR: "Admin", SUPER_ADMIN: "Super Admin" };
const ROLE_RANK: Record<AppRole, number> = { USER: 0, APP_MODERATOR: 1, SUPER_ADMIN: 2 };
const ROLE_ABILITIES: Record<AppRole, string> = {
  USER: "You have regular member access to Smart Campus.",
  APP_MODERATOR: "You can now open the Admin dashboard to review events, moderate posts and communities, and manage users.",
  SUPER_ADMIN: "You now have full control of Smart Campus, including the Admin dashboard and the ability to add or remove Admins and Super Admins.",
};

export type RoleChangeMail = { email: string; username: string; previousRole: AppRole; newRole: AppRole; changedBy: string };

/** Tells a user their app-wide role changed. Throws only when delivery fails; callers treat it as best-effort. */
export async function sendRoleChangeEmail(mail: RoleChangeMail) {
  const from = process.env.AUTH_FROM_EMAIL;
  const client = getTransporter();
  const previous = ROLE_LABELS[mail.previousRole];
  const next = ROLE_LABELS[mail.newRole];
  const promoted = ROLE_RANK[mail.newRole] > ROLE_RANK[mail.previousRole];
  if (!client || !from) {
    console.info(`[Smart Campus role] ${mail.username} <${mail.email}>: ${previous} -> ${next} (by ${mail.changedBy})`);
    return { delivered: false as const };
  }
  const subject = (promoted ? `You're now a ${next} on Smart Campus` : `Your Smart Campus role changed to ${next}`).replace(/[\r\n]/g, " ");
  const url = `${SITE_URL}/`;
  const text = `Hi ${mail.username},\n\n${mail.changedBy} changed your Smart Campus role from ${previous} to ${next}.\n\n${ROLE_ABILITIES[mail.newRole]}\n\nOpen Smart Campus: ${url}\n\nIf you think this was a mistake, contact a Smart Campus Super Admin.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px"><h1 style="font-size:22px">${escapeHtml(promoted ? `You're now a ${next}` : `Your role changed to ${next}`)}</h1><p>Hi ${escapeHtml(mail.username)},</p><p><b>${escapeHtml(mail.changedBy)}</b> changed your Smart Campus role from <b>${escapeHtml(previous)}</b> to <b>${escapeHtml(next)}</b>.</p><p style="color:#6d6878">${escapeHtml(ROLE_ABILITIES[mail.newRole])}</p><p style="margin:28px 0"><a href="${escapeHtml(url)}" style="background:#6C3BFF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Open Smart Campus</a></p><p style="color:#6d6878;font-size:12px">If you think this was a mistake, contact a Smart Campus Super Admin.</p></div>`;
  await client.sendMail({ from, to: mail.email, subject, text, html });
  return { delivered: true as const };
}
