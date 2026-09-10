import type { NextRequest } from "next/server";
import { updateProfile } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const about = typeof body?.about === "string" ? body.about : "";
  const campus = typeof body?.campus === "string" ? body.campus : "";
  const result = await updateProfile(userId, username, about, campus);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 400 }) : noStoreJson({ data: result });
}
