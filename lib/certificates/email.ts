import nodemailer from "nodemailer";
import { substitute, type JobRecord, type JobRow } from "./model";
export function smtpConfigured() { return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && (process.env.CERTIFICATE_FROM_EMAIL || process.env.AUTH_FROM_EMAIL)); }
export function certificateTransport() {
  if (!smtpConfigured()) throw new Error("Configure SMTP_HOST, SMTP_USER, SMTP_PASS and CERTIFICATE_FROM_EMAIL before emailing certificates");
  return nodemailer.createTransport({ pool: true, maxConnections: 2, maxMessages: 50, host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 45000 });
}
export function certificateMail(job: Pick<JobRecord, "id" | "emailTemplate">, row: Pick<JobRow, "id" | "rowNumber" | "emailNormalized" | "values" | "verificationCode">, bytes: Uint8Array) {
  const subject = substitute(job.emailTemplate.subject, row.values, row.verificationCode).replace(/[\r\n]/g, " ").slice(0, 250);
  const text = substitute(job.emailTemplate.text, row.values, row.verificationCode);
  const html = text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!).replace(/\n/g, "<br>");
  return { from: process.env.CERTIFICATE_FROM_EMAIL || process.env.AUTH_FROM_EMAIL, to: row.emailNormalized, subject, text, html: `<div style="font:16px/1.6 Arial,sans-serif">${html}</div>`, messageId: `<certificate-${job.id}-${row.id}@smart-campus.local>`, attachments: [{ filename: `certificate-${row.rowNumber}.png`, content: Buffer.from(bytes), contentType: "image/png" }] };
}
