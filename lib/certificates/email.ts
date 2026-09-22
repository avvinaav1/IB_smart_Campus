import { readFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { substitute, type JobRecord, type JobRow } from "./model";
export function smtpConfigured() { return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.CERTIFICATE_FROM_EMAIL || process.env.AUTH_FROM_EMAIL)); }
export function certificateTransport() {
  if (!smtpConfigured()) throw new Error("Configure SMTP_HOST, SMTP_USER, SMTP_PASS and CERTIFICATE_FROM_EMAIL before emailing certificates");
  return nodemailer.createTransport({ pool: true, maxConnections: 2, maxMessages: 50, host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 45000 });
}
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function siteOrigin() { return (process.env.APP_BASE_URL || "https://ibcampus.icebrkr.space").replace(/\/+$/, ""); }
function absoluteAssetUrl(path: string) { return /^https?:\/\//.test(path) ? path : `${siteOrigin()}${path.startsWith("/") ? path : `/${path}`}`; }
const LOGO_CID = "icebrkr-logo";
let logoBuffer: Buffer | undefined;
// Embedded as a CID attachment rather than a hosted <img src>: it's a fixed,
// bundled asset, so this renders correctly regardless of whether APP_BASE_URL
// (or the production domain's static files) are actually deployed and
// reachable — unlike the event banner below, which is genuinely per-organizer
// content and has no local file to embed.
function logoAttachment() {
  if (!logoBuffer) logoBuffer = readFileSync(join(process.cwd(), "public", "logo.jpeg"));
  return { filename: "icebrkr.jpeg", content: logoBuffer, contentType: "image/jpeg", cid: LOGO_CID };
}
export type CertificateMailEvent = { title: string; imageUrl: string };
export function certificateMail(job: Pick<JobRecord, "id" | "emailTemplate">, row: Pick<JobRow, "id" | "emailNormalized" | "values" | "verificationCode">, event?: CertificateMailEvent) {
  const subject = substitute(job.emailTemplate.subject, row.values, row.verificationCode, event?.title).replace(/[\r\n]/g, " ").slice(0, 250);
  const text = substitute(job.emailTemplate.text, row.values, row.verificationCode, event?.title);
  const bodyHtml = escapeHtml(text).replace(/\n/g, "<br>");
  const dot = (color: string) => `<span style="color:${color};font-size:12px;letter-spacing:2px">■</span>`;
  const banner = event ? `
      <tr><td style="line-height:0;font-size:0">
        <img src="${absoluteAssetUrl(event.imageUrl)}" alt="" width="600" style="display:block;width:100%;max-height:230px;object-fit:cover;background:#f6f5f2" />
      </td></tr>
      <tr><td style="padding:14px 32px;border-bottom:1px solid #ece9e2">
        ${dot("#e8112e")}${dot("#f0923a")}${dot("#79b87d")}
        <span style="font:800 12px/1 Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;color:#1a1a1a;margin-left:6px">${escapeHtml(event.title)}</span>
      </td></tr>` : "";
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f5f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f2;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ece9e2;box-shadow:0 18px 40px -26px rgba(20,18,10,.25)">
      <tr><td style="background:#ffffff;padding:30px 28px 22px;text-align:center">
        <img src="cid:${LOGO_CID}" alt="icebrkr" height="52" style="display:inline-block;height:52px;max-width:280px" />
      </td></tr>
      <tr><td style="line-height:0;font-size:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="34%" bgcolor="#e8112e" style="background:#e8112e;height:6px;font-size:0;line-height:0">&nbsp;</td>
        <td width="33%" bgcolor="#f0923a" style="background:#f0923a;height:6px;font-size:0;line-height:0">&nbsp;</td>
        <td width="33%" bgcolor="#79b87d" style="background:#79b87d;height:6px;font-size:0;line-height:0">&nbsp;</td>
      </tr></table></td></tr>${banner}
      <tr><td style="padding:32px 32px 8px">
        <div style="font:16px/1.7 Arial,sans-serif;color:#1a1a1a">${bodyHtml}</div>
      </td></tr>
      <tr><td style="padding:8px 32px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff3e8" style="background:#fff3e8;border:1px solid #f5d3ae;border-radius:12px">
          <tr><td style="padding:16px 18px;font:600 13px/1.5 Arial,sans-serif;color:#8a4a12">🎓 Your certificate is ready — congratulations! 😊<br/><span style="font-weight:500">Create a free account or sign in with <b>${escapeHtml(row.emailNormalized || "this email address")}</b> on IB Smart Campus to view and download it.</span></td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 32px 30px;text-align:center">
        <a href="${absoluteAssetUrl("/")}?claimEmail=${encodeURIComponent(row.emailNormalized || "")}" style="display:inline-block;background:#1a1a1a;color:#ffffff;font:800 12px/1 Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;text-decoration:none;padding:14px 26px;border-radius:999px">Get my certificate →</a>
        <div style="margin-top:10px;font:500 10px/1.5 Arial,sans-serif;color:#8a8578">We'll send a one-time code to ${escapeHtml(row.emailNormalized || "your email")} to confirm it's you.</div>
      </td></tr>
      <tr><td style="background:#f6f5f2;padding:20px 28px;text-align:center;border-top:1px solid #ece9e2">
        <div style="font:800 12px/1 Arial,sans-serif;letter-spacing:.5px;color:#1a1a1a">IB SMART CAMPUS</div>
        <div style="font:600 10px/1 Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#8a8578;margin-top:8px">✦ Powered by icebrkr ✦</div>
      </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  return { from: process.env.CERTIFICATE_FROM_EMAIL || process.env.AUTH_FROM_EMAIL, to: row.emailNormalized, subject, text, html, messageId: `<certificate-${job.id}-${row.id}@smart-campus.local>`, attachments: [logoAttachment()] };
}
