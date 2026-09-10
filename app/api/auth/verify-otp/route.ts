import type { NextRequest } from "next/server";
import { normalizeEmail, verifyOtp } from "@/lib/auth-store";
import { isAuthIntent, isSameOrigin, noStoreJson, readJson, setSessionCookie } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const body = await readJson(request);
  const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const intent = body?.intent;
  if (!email || !/^\d{6}$/.test(code) || !isAuthIntent(intent)) return noStoreJson({ error: "Enter the complete 6-digit code." }, { status: 400 });

  let result: Awaited<ReturnType<typeof verifyOtp>>;
  try { result = await verifyOtp(email, intent, code); }
  catch (error) { console.error("Authentication storage failed", { code: (error as NodeJS.ErrnoException).code || "unavailable" }); return noStoreJson({ error: "Account storage is unavailable. Check the server configuration." }, { status: 503 }); }
  if ("error" in result) return noStoreJson({ error: result.error }, { status: 401 });

  return setSessionCookie(noStoreJson({ data: { user: result.user } }), result.token, result.maxAge);
}
