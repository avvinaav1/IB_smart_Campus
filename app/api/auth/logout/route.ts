import type { NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  await revokeSession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = noStoreJson({ data: { loggedOut: true } });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}

