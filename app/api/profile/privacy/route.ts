import type { NextRequest } from "next/server";
import { updatePrivacy } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (typeof body?.isPrivate !== "boolean") return noStoreJson({ error: "Choose a valid privacy setting." }, { status: 400 });
  const result = await updatePrivacy(userId, body.isPrivate);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 404 }) : noStoreJson({ data: result });
}
