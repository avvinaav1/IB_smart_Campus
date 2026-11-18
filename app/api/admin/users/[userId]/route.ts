import type { NextRequest } from "next/server";
import { getAdminUser, setUserAppRole } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { cascadeDeleteUser } from "@/lib/moderation-cascade";
import { sendRoleChangeEmail } from "@/lib/role-change-email";
import { requireGlobalModerator, requireSuperAdmin } from "@/lib/moderation-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ userId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireSuperAdmin(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body?.appRole !== "USER" && body?.appRole !== "APP_MODERATOR" && body?.appRole !== "SUPER_ADMIN") return noStoreJson({ error: "Choose USER, APP_MODERATOR or SUPER_ADMIN." }, { status: 400 });
  const { userId } = await context.params;
  const result = await setUserAppRole(auth.user.id, userId, body.appRole);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const { previousRole, user } = result;
  if (previousRole !== user.appRole) {
    // Best-effort: the role change is already saved, so a mail failure must not fail the request.
    try {
      await sendRoleChangeEmail({ email: user.email, username: user.username, previousRole, newRole: user.appRole, changedBy: auth.user.username });
    } catch (error) {
      console.error("Role change email failed", { userId, error });
    }
  }
  return noStoreJson({ data: { user } });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const { userId } = await context.params;
  const target = await getAdminUser(userId);
  if (target?.appRole === "SUPER_ADMIN" && auth.user.appRole !== "SUPER_ADMIN") return noStoreJson({ error: "Only a Super Admin can delete a Super Admin account." }, { status: 403 });
  try {
    const result = await cascadeDeleteUser(userId);
    if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
    return result.deleted ? noStoreJson({ data: { deleted: { type: "user", id: userId } } }) : noStoreJson({ error: "Account not found." }, { status: 404 });
  } catch (error) {
    console.error("Account deletion failed", { userId, error });
    return noStoreJson({ error: "Account deletion did not finish. Retry to complete it safely." }, { status: 503 });
  }
}
