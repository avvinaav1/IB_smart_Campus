import "server-only";
import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { FieldValue, type Query } from "firebase-admin/firestore";
import { firestore } from "@/lib/firebase-admin";
import { absoluteAssetUrl, bulkMailHeaders, escapeHtml, LOGO_CID, logoAttachment } from "./email";
import { hashId } from "./store";

// Reminder emails for certificates that were emailed but never claimed.
//
// One campaign runs at a time, stored in a single doc. Each "tick" leases the
// campaign, reads at most one batch of pending claims (never more than today's
// remaining email quota), emails each distinct address once per campaign and
// saves a cursor, so the whole backlog is walked exactly once across many small
// requests. Reads per tick ≈ batch size + 3, which keeps a day's total far below
// Firestore's 50k free-tier read limit. Ticks come from the admin dashboard
// while it's open and from the cron route, so a campaign finishes on its own.
const campaignRef = () => firestore().collection("certificateReminders").doc("campaign");
const claims = () => firestore().collection("certificateClaims");
// Per-campaign "already emailed this address" markers. Created with create(),
// which fails on an existing doc — dedupes across batches without any reads.
const sentLog = () => firestore().collection("certificateReminderLog");

const LEASE_MS = 90_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Math.floor(Number(process.env[name]));
  return Number.isFinite(value) && value > 0 ? Math.min(max, Math.max(min, value)) : fallback;
};
export const reminderSettings = () => ({
  batchSize: intEnv("REMINDER_BATCH_SIZE", 50, 1, 200),
  dailyLimit: intEnv("REMINDER_DAILY_LIMIT", 450, 1, 20_000),
  minAgeHours: intEnv("REMINDER_MIN_AGE_HOURS", 24, 1, 24 * 90),
});

// Uses the same sender and SMTP login as certificate/login mail by default.
// Any REMINDER_* variable overrides its counterpart, e.g. to send reminders
// from a separate mailbox.
function smtpEnv() {
  const host = process.env.REMINDER_SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.REMINDER_SMTP_PORT || process.env.SMTP_PORT || 587);
  const secureEnv = process.env.REMINDER_SMTP_SECURE ?? process.env.SMTP_SECURE;
  return {
    host, port, secure: secureEnv ? secureEnv === "true" : port === 465,
    user: process.env.REMINDER_SMTP_USER || process.env.SMTP_USER,
    pass: process.env.REMINDER_SMTP_PASS || process.env.SMTP_PASS,
    from: process.env.REMINDER_FROM_EMAIL || process.env.CERTIFICATE_FROM_EMAIL || process.env.AUTH_FROM_EMAIL,
  };
}
export function reminderSmtpConfigured() { const env = smtpEnv(); return Boolean(env.host && env.user && env.pass && env.from); }
let transport: Transporter | undefined;
function reminderTransport() {
  const env = smtpEnv();
  if (!reminderSmtpConfigured()) throw new Error("Configure SMTP_HOST, SMTP_USER, SMTP_PASS and AUTH_FROM_EMAIL to send reminders.");
  transport ??= nodemailer.createTransport({ pool: true, maxConnections: 1, maxMessages: 100, host: env.host, port: env.port, secure: env.secure, auth: { user: env.user, pass: env.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
  return transport;
}

type PendingCert = { title: string; issuerName: string };
export function reminderMail(email: string, certificates: PendingCert[]) {
  const first = certificates[0];
  const subject = (certificates.length === 1 ? `Reminder: your "${first.title}" certificate is waiting` : `Reminder: ${certificates.length} certificates are waiting for you`).replace(/[\r\n]/g, " ").slice(0, 250);
  const lines = certificates.map(cert => `• ${cert.title} — from ${cert.issuerName}`);
  const link = `${absoluteAssetUrl("/")}?claimEmail=${encodeURIComponent(email)}`;
  const text = `Hi,\n\nYou were awarded ${certificates.length === 1 ? "a certificate" : "certificates"} on IB Smart Campus that you haven't claimed yet:\n\n${lines.join("\n")}\n\nCreate a free account or sign in with ${email} to view and download ${certificates.length === 1 ? "it" : "them"}:\n${link}\n\n— IB Smart Campus`;
  const items = certificates.map(cert => `<tr><td style="padding:10px 14px;border-top:1px solid #ece9e2;font:600 14px/1.5 Arial,sans-serif;color:#1a1a1a">🎓 ${escapeHtml(cert.title)}<br><span style="font-weight:500;font-size:12px;color:#8a8578">from ${escapeHtml(cert.issuerName)}</span></td></tr>`).join("");
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f5f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f5f2;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #ece9e2">
      <tr><td style="padding:30px 28px 22px;text-align:center"><img src="cid:${LOGO_CID}" alt="icebrkr" height="52" style="display:inline-block;height:52px;max-width:280px" /></td></tr>
      <tr><td style="line-height:0;font-size:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="34%" bgcolor="#e8112e" style="background:#e8112e;height:6px">&nbsp;</td>
        <td width="33%" bgcolor="#f0923a" style="background:#f0923a;height:6px">&nbsp;</td>
        <td width="33%" bgcolor="#79b87d" style="background:#79b87d;height:6px">&nbsp;</td>
      </tr></table></td></tr>
      <tr><td style="padding:32px 32px 12px;font:16px/1.7 Arial,sans-serif;color:#1a1a1a">Hi 👋<br>Just a reminder — ${certificates.length === 1 ? "your certificate is" : "your certificates are"} still waiting to be claimed:</td></tr>
      <tr><td style="padding:0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece9e2;border-radius:12px;border-top:0">${items}</table></td></tr>
      <tr><td style="padding:18px 32px 0;font:500 13px/1.6 Arial,sans-serif;color:#8a4a12">Create a free account or sign in with <b>${escapeHtml(email)}</b> and ${certificates.length === 1 ? "it's" : "they're"} added to your profile automatically.</td></tr>
      <tr><td style="padding:20px 32px 30px;text-align:center">
        <a href="${link}" style="display:inline-block;background:#1a1a1a;color:#ffffff;font:800 12px/1 Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;text-decoration:none;padding:14px 26px;border-radius:999px">Claim my certificate →</a>
      </td></tr>
      <tr><td style="background:#f6f5f2;padding:20px 28px;text-align:center;border-top:1px solid #ece9e2">
        <div style="font:800 12px/1 Arial,sans-serif;letter-spacing:.5px;color:#1a1a1a">IB SMART CAMPUS</div>
        <div style="font:600 10px/1 Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#8a8578;margin-top:8px">✦ Powered by icebrkr ✦</div>
      </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  const from = smtpEnv().from;
  return { from, to: email, subject, text, html, ...bulkMailHeaders(from, `reminder-${randomUUID()}`), attachments: [logoAttachment()] };
}

export type ReminderStatus = "running" | "completed" | "cancelled" | "failed";
export type ReminderCampaign = {
  id: string; status: ReminderStatus; startedAt: number; startedBy: string; cutoff: number;
  totalAtStart: number; scanned: number; sent: number; skipped: number; failed: number;
  cursor: string | null; dayKey: string; sentToday: number; dailyLimit: number; batchSize: number;
  leaseUntil: number; lastRunAt: number | null; finishedAt: number | null; error: string | null;
};
const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

export async function getReminderOverview() {
  const snapshot = await campaignRef().get();
  const campaign = snapshot.exists ? snapshot.data() as ReminderCampaign : null;
  const now = Date.now();
  const sentToday = campaign && campaign.dayKey === dayKey(now) ? campaign.sentToday : 0;
  return {
    configured: reminderSmtpConfigured(), from: smtpEnv().from || null, ...reminderSettings(),
    campaign: campaign && { ...campaign, sentToday, limitReached: campaign.status === "running" && sentToday >= campaign.dailyLimit, resumesAt: Math.floor(now / DAY_MS) * DAY_MS + DAY_MS, cursor: undefined },
  };
}

export async function startReminderCampaign(userId: string) {
  if (!reminderSmtpConfigured()) return { error: "Reminder email isn't configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and AUTH_FROM_EMAIL.", status: 503 } as const;
  const now = Date.now(), settings = reminderSettings(), cutoff = now - settings.minAgeHours * 60 * 60 * 1000;
  // Aggregation: bills 1 read per 1,000 matches.
  const totalAtStart = (await claims().where("claimed", "==", false).where("createdAt", "<", cutoff).count().get()).data().count;
  const started = await firestore().runTransaction(async tx => {
    const current = await tx.get(campaignRef());
    if (current.exists && current.get("status") === "running") return false;
    const campaign: ReminderCampaign = {
      id: randomUUID(), status: totalAtStart ? "running" : "completed", startedAt: now, startedBy: userId, cutoff, totalAtStart,
      scanned: 0, sent: 0, skipped: 0, failed: 0, cursor: null, dayKey: dayKey(now), sentToday: 0,
      dailyLimit: settings.dailyLimit, batchSize: settings.batchSize, leaseUntil: 0, lastRunAt: null,
      finishedAt: totalAtStart ? null : now, error: null,
    };
    tx.set(campaignRef(), campaign);
    return true;
  });
  return started ? { ok: true } as const : { error: "A reminder run is already in progress.", status: 409 } as const;
}

export async function cancelReminderCampaign() {
  await firestore().runTransaction(async tx => {
    const current = await tx.get(campaignRef());
    if (current.exists && current.get("status") === "running") tx.update(campaignRef(), { status: "cancelled", finishedAt: Date.now(), leaseUntil: 0 });
  });
}

// Runs at most one batch. Returns true if it did any work, so callers with a
// longer time budget (the cron route) can loop.
export async function runReminderBatch(budgetMs: number) {
  const started = Date.now(), today = dayKey(started);
  const campaign = await firestore().runTransaction(async tx => {
    const snapshot = await tx.get(campaignRef());
    if (!snapshot.exists) return null;
    const current = snapshot.data() as ReminderCampaign;
    if (current.status !== "running" || current.leaseUntil > started) return null;
    const sentToday = current.dayKey === today ? current.sentToday : 0;
    if (sentToday >= current.dailyLimit) return null;
    tx.update(campaignRef(), { leaseUntil: started + LEASE_MS, dayKey: today, sentToday });
    return { ...current, dayKey: today, sentToday };
  });
  if (!campaign) return false;

  const limit = Math.min(campaign.batchSize, campaign.dailyLimit - campaign.sentToday);
  let query: Query = claims().where("claimed", "==", false).where("createdAt", "<", campaign.cutoff).orderBy("createdAt", "desc");
  if (campaign.cursor) {
    const cursorDoc = await claims().doc(campaign.cursor).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }
  const page = await query.limit(limit).get();

  // Everything pending for an address in this page goes into one email.
  const byEmail = new Map<string, PendingCert[]>();
  for (const doc of page.docs) {
    const email = String(doc.get("email") || "");
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), { title: String(doc.get("title") || "Certificate"), issuerName: String(doc.get("issuerName") || "IB Smart Campus") }]);
  }

  let cursor = campaign.cursor, scanned = 0, sent = 0, skipped = 0, failed = 0, fatal: string | null = null;
  const handled = new Set<string>();
  for (const doc of page.docs) {
    if (Date.now() - started > budgetMs) break;
    const email = String(doc.get("email") || "");
    if (!email || handled.has(email)) { scanned++; skipped++; cursor = doc.id; continue; }
    const marker = sentLog().doc(hashId("reminder", campaign.id, email));
    try { await marker.create({ campaignId: campaign.id, email, createdAt: Date.now() }); }
    catch (error) {
      // ALREADY_EXISTS: this address was emailed earlier in this campaign.
      if ((error as { code?: unknown }).code === 6) { scanned++; skipped++; cursor = doc.id; handled.add(email); continue; }
      // Transient Firestore trouble: keep progress so far; the next tick resumes here.
      console.error("Certificate reminder marker failed", { code: (error as { code?: unknown }).code ?? "unavailable" });
      break;
    }
    scanned++; cursor = doc.id; handled.add(email);
    try {
      await reminderTransport().sendMail(reminderMail(email, byEmail.get(email) || []));
      sent++;
      const writer = firestore().batch();
      for (const same of page.docs) if (same.get("email") === email) writer.update(same.ref, { reminderCount: FieldValue.increment(1), lastRemindedAt: Date.now() });
      await writer.commit();
    } catch (error) {
      failed++;
      await marker.delete().catch(() => undefined);
      const code = (error as { code?: unknown }).code;
      console.error("Certificate reminder email failed", { code: code ?? "unavailable" });
      // Bad credentials / unreachable server would fail every address — stop instead.
      if (code === "EAUTH" || code === "ECONNECTION" || code === "ESOCKET" || code === "EDNS") { fatal = `SMTP error (${String(code)}). Check the reminder SMTP settings, then start a new run.`; break; }
    }
  }
  const exhausted = !fatal && scanned === page.size && page.size < limit;

  await firestore().runTransaction(async tx => {
    const current = await tx.get(campaignRef());
    if (!current.exists || current.get("id") !== campaign.id) return;
    const now = Date.now(), stillRunning = current.get("status") === "running";
    tx.update(campaignRef(), {
      cursor, scanned: FieldValue.increment(scanned), sent: FieldValue.increment(sent), skipped: FieldValue.increment(skipped), failed: FieldValue.increment(failed),
      sentToday: FieldValue.increment(sent + failed), leaseUntil: 0, lastRunAt: now,
      ...(stillRunning && fatal ? { status: "failed", error: fatal, finishedAt: now } : {}),
      ...(stillRunning && exhausted ? { status: "completed", finishedAt: now } : {}),
    });
  });
  return scanned > 0 || exhausted || Boolean(fatal);
}
