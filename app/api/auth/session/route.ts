import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  return noStoreJson({ data: user ? { authenticated: true, user } : { authenticated: false } });
}

