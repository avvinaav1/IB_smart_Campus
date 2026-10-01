import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/auth-http";
import { getReminderOverview, runReminderBatch } from "@/lib/certificates/reminders";

export const runtime = "nodejs";
export const maxDuration = 60;
const RUN_BUDGET_MS = 45_000;

// Scheduler entry point (Vercel Cron or any external cron) so a reminder run
// keeps going without the admin dashboard open. Sends `Authorization: Bearer <CRON_SECRET>`.
function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`), given = Buffer.from(request.headers.get("authorization") || "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return noStoreJson({ error: "Unauthorized." }, { status: 401 });
  const started = Date.now();
  let batches = 0;
  try {
    while (Date.now() - started < RUN_BUDGET_MS - 5_000 && await runReminderBatch(RUN_BUDGET_MS - (Date.now() - started))) batches++;
  } catch (error) {
    console.error("Certificate reminder cron failed", { code: (error as { code?: unknown }).code ?? "unavailable" });
  }
  const { campaign } = await getReminderOverview();
  return noStoreJson({ data: { batches, status: campaign?.status ?? null, sent: campaign?.sent ?? 0, sentToday: campaign?.sentToday ?? 0 } });
}
