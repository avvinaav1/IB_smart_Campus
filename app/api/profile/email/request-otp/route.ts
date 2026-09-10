import type { NextRequest } from "next/server";
import { discardEmailChangeOtp, isValidEmail, issueEmailChangeOtp, normalizeEmail } from "@/lib/auth-store";
import { authenticatedUserId, getClientId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { sendOtpEmail } from "@/lib/otp-email";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const newEmail = normalizeEmail(typeof body?.newEmail === "string" ? body.newEmail : "");
  if (!isValidEmail(newEmail)) return noStoreJson({ error: "Enter a valid new email address." }, { status: 400 });
  const issued = await issueEmailChangeOtp(userId, newEmail, getClientId(request));
  if ("error" in issued) return noStoreJson({ error: issued.error }, { status: "retryAfter" in issued ? 429 : 409 });
  try {
    const delivery = await sendOtpEmail(newEmail, issued.code, "change-email");
    return noStoreJson({ data: { newEmail, expiresIn: 600 }, ...(delivery.delivered ? {} : { meta: { devCode: issued.code } }) });
  } catch (error) {
    await discardEmailChangeOtp(userId, newEmail);
    console.error("Email-change OTP delivery failed", error);
    return noStoreJson({ error: "We could not send the email right now. Please try again." }, { status: 502 });
  }
}

