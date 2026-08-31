import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";
import { getUserDashboard } from "@/lib/post-store";
import { countFollowers } from "@/lib/social-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const [dashboard, followers] = await Promise.all([getUserDashboard(user.id), countFollowers(user.id)]);
  return noStoreJson({ data: { dashboard: { ...dashboard, followers } } });
}
