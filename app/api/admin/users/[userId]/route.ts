import type { NextRequest } from "next/server";
import { setUserAppRole } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { cascadeDeleteUser } from "@/lib/moderation-cascade";
import { requireGlobalModerator, requireSuperAdmin } from "@/lib/moderation-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body?.appRole !== "USER" && body?.appRole !== "APP_MODERATOR") return noStoreJson({ error: "Choose USER or APP_MODERATOR." }, { status: 400 });
  const { userId } = await context.params;
  const result = await setUserAppRole(userId, body.appRole);
  return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const { userId } = await context.params;
  try {
    const result = await cascadeDeleteUser(userId);
    if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
    return result.deleted ? noStoreJson({ data: { deleted: { type: "user", id: userId } } }) : noStoreJson({ error: "Account not found." }, { status: 404 });
  } catch (error) {
    console.error("Account deletion failed", { userId, error });
    return noStoreJson({ error: "Account deletion did not finish. Retry to complete it safely." }, { status: 503 });
  }
}
