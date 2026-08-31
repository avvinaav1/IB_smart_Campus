import type { NextRequest } from "next/server";
import { normalizeEmail, passwordLogin } from "@/lib/auth-store";
import { getClientId, isSameOrigin, noStoreJson, readJson, setSessionCookie } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const body = await readJson(request);
  const email = normalizeEmail(typeof body?.email === "string" ? body.email : "");
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return noStoreJson({ error: "Enter your email and password." }, { status: 400 });
  const result = await passwordLogin(email, password, getClientId(request));
  if ("error" in result) return noStoreJson({ error: result.error }, { status: "retryAfter" in result ? 429 : 401 });
  return setSessionCookie(noStoreJson({ data: { user: result.user } }), result.token, result.maxAge);
}

