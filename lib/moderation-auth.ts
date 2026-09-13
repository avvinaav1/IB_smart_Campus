import "server-only";

import type { NextRequest } from "next/server";
import { getFreshSession } from "@/lib/auth-store";
import { getCommunityAccess } from "@/lib/community-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";
import type { SessionUser } from "@/lib/types";
import { canDelegateAppRoles, isGlobalModerator, isScopedCommunityModerator } from "@/lib/moderation-policy";

export type AuthorizationResult = { user: SessionUser } | { response: ReturnType<typeof noStoreJson> };

function denied(message: string, status: number): AuthorizationResult {
  return { response: noStoreJson({ error: message }, { status }) };
}

export async function requireAuthenticatedUser(request: NextRequest): Promise<AuthorizationResult> {
  const user = await getFreshSession(request.cookies.get(SESSION_COOKIE)?.value);
  return user ? { user } : denied("Your session has expired.", 401);
}

export async function requireGlobalModerator(request: NextRequest): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  return isGlobalModerator(auth.user.appRole)
    ? auth
    : denied("Global moderator access is required.", 403);
}

export async function requireSuperAdmin(request: NextRequest): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  return canDelegateAppRoles(auth.user.appRole) ? auth : denied("Super Admin access is required.", 403);
}

export async function requireCommunityAdmin(request: NextRequest, communityId: string): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  const access = await getCommunityAccess(communityId, auth.user.id);
  if (!access) return denied("Community not found.", 404);
  return access.role === "COMMUNITY_ADMIN" ? auth : denied("Community admin access is required.", 403);
}

export async function requireCommunityModerator(request: NextRequest, communityId: string): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  const access = await getCommunityAccess(communityId, auth.user.id);
  if (!access) return denied("Community not found.", 404);
  return isScopedCommunityModerator(auth.user.appRole, access?.role)
    ? auth
    : denied("Community moderator access is required.", 403);
}
