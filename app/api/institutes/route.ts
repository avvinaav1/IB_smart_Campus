import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { getFreshSession } from "@/lib/auth-store";
import { createInstitute, listInstitutes } from "@/lib/institute-store";
import { canManageInstitutes } from "@/lib/moderation-policy";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request); if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { institutes: await listInstitutes(userId) } });
}
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request); if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const session = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value); if (!session || !canManageInstitutes(session.appRole)) return noStoreJson({ error: "Global moderator access is required." }, { status: 403 });
  const body = await readJson(request); if (!body || typeof body.name !== "string") return noStoreJson({ error: "Institute name is required." }, { status: 400 });
  const result = await createInstitute(userId, body.name, typeof body.description === "string" ? body.description : "");
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: 201 });
}
