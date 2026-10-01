import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { cancelReminderCampaign, getReminderOverview, runReminderBatch, startReminderCampaign } from "@/lib/certificates/reminders";
import { requireGlobalModerator } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
// One batch per request; the dashboard keeps calling "tick" while a run is active.
const TICK_BUDGET_MS = 40_000;

export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  return noStoreJson({ data: await getReminderOverview() });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const action = (await readJson(request))?.action;
  try {
    if (action === "start") {
      const result = await startReminderCampaign(auth.user.id);
      if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
      await runReminderBatch(TICK_BUDGET_MS);
    } else if (action === "tick") await runReminderBatch(TICK_BUDGET_MS);
    else if (action === "cancel") await cancelReminderCampaign();
    else return noStoreJson({ error: "Choose start, tick or cancel." }, { status: 400 });
    return noStoreJson({ data: await getReminderOverview() });
  } catch (error) {
    const missingIndex = (error as { code?: unknown }).code === 9;
    console.error("Certificate reminder request failed", { action, code: (error as { code?: unknown }).code ?? "unavailable" });
    return noStoreJson({ error: missingIndex ? "Deploy the Firestore indexes (firebase deploy --only firestore:indexes) first." : "Reminder batch failed; it will resume on the next attempt." }, { status: missingIndex ? 503 : 500 });
  }
}
