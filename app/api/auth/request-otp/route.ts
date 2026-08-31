import type { NextRequest } from "next/server";
import { discardOtp, isValidEmail, issueOtp, normalizeEmail } from "@/lib/auth-store";
import { getClientId, isAuthIntent, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { sendOtpEmail } from "@/lib/otp-email";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const body = await readJson(request);
  const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
  const intent = body?.intent;
  const referralCode = typeof body?.referralCode === "string" ? body.referralCode : "";
  if (!isValidEmail(email) || !isAuthIntent(intent)) return noStoreJson({ error: "Enter a valid email address." }, { status: 400 });

  const issued = await issueOtp(email, intent, getClientId(request), referralCode);
  if ("error" in issued) {
    const status = "retryAfter" in issued ? 429 : 409;
    const response = noStoreJson({ error: issued.error, retryAfter: "retryAfter" in issued ? issued.retryAfter : undefined }, { status });
    if ("retryAfter" in issued) response.headers.set("Retry-After", String(issued.retryAfter));
    return response;
  }

  try {
    const delivery = await sendOtpEmail(email, issued.code, intent);
    return noStoreJson({
      data: { email, expiresIn: 600, resendAfter: 60 },
      ...(delivery.delivered ? {} : { meta: { devCode: issued.code } }),
    });
  } catch (error) {
    await discardOtp(email);
    console.error("OTP delivery failed", error);
    return noStoreJson({ error: "We could not send the email right now. Please try again." }, { status: 502 });
  }
}
