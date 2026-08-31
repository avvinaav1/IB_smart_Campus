import type { NextRequest } from "next/server";
import { setPassword } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  const result = await setPassword(userId, currentPassword, newPassword);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 400 }) : noStoreJson({ data: result });
}

