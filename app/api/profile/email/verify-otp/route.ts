import type { NextRequest } from "next/server";
import { normalizeEmail, verifyEmailChangeOtp } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const newEmail = normalizeEmail(typeof body?.newEmail === "string" ? body.newEmail : "");
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!newEmail || !/^\d{6}$/.test(code)) return noStoreJson({ error: "Enter the complete 6-digit code." }, { status: 400 });
  const result = await verifyEmailChangeOtp(userId, newEmail, code);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 401 }) : noStoreJson({ data: result });
}

