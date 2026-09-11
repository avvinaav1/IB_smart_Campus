import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof getSession>>;
  try { user = await getSession(request.cookies.get(SESSION_COOKIE)?.value); }
  catch (error) { console.error("Authentication storage failed", { code: (error as NodeJS.ErrnoException).code || "unavailable" }); return noStoreJson({ error: "Account storage is unavailable. Check the server configuration." }, { status: 503 }); }
  return noStoreJson({ data: user ? { authenticated: true, user } : { authenticated: false } });
}
