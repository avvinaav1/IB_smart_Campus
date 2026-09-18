import "server-only";

import type { NextRequest } from "next/server";
import { getFreshSession } from "@/lib/auth-store";
import { getCommunityAccess } from "@/lib/community-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";
import type { SessionUser } from "@/lib/types";
import { canDelegateAppRoles, isGlobalModerator, isScopedCommunityModerator } from "@/lib/moderation-policy";
import { getInstituteMembership } from "@/lib/institute-store";
import { getCommunitySummary } from "@/lib/community-store";
import type { InstituteRole } from "@/lib/types";

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
  const community = await getCommunitySummary(communityId);
  const instituteMember = community?.instituteId ? await getInstituteMembership(community.instituteId, auth.user.id) : null;
  return isScopedCommunityModerator(auth.user.appRole, access?.role) || instituteMember?.role === "INSTITUTE_ADMIN" || instituteMember?.role === "INSTITUTE_MODERATOR"
    ? auth
    : denied("Community moderator access is required.", 403);
}

export async function requireCommunityEventApprover(request: NextRequest, communityId: string): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  if (isGlobalModerator(auth.user.appRole)) return auth;
  const [access, community] = await Promise.all([getCommunityAccess(communityId, auth.user.id), getCommunitySummary(communityId)]);
  if (!access || !community) return denied("Community not found.", 404);
  if (!community.instituteId && isScopedCommunityModerator(auth.user.appRole, access.role)) return auth;
  if (access.role === "COMMUNITY_ADMIN") return auth;
  const instituteMember = community.instituteId ? await getInstituteMembership(community.instituteId, auth.user.id) : null;
  return instituteMember?.role === "INSTITUTE_ADMIN" || instituteMember?.role === "INSTITUTE_MODERATOR"
    ? auth
    : denied("Community event approval access is required.", 403);
}

export async function requireInstituteRole(request: NextRequest, instituteId: string, minimum: InstituteRole = "INSTITUTE_MODERATOR"): Promise<AuthorizationResult> {
  const auth = await requireAuthenticatedUser(request);
  if ("response" in auth) return auth;
  if (isGlobalModerator(auth.user.appRole)) return auth;
  const member = await getInstituteMembership(instituteId, auth.user.id);
  const rank: Record<InstituteRole, number> = { INSTITUTE_MEMBER: 0, INSTITUTE_MODERATOR: 1, INSTITUTE_ADMIN: 2 };
  if (!member || rank[member.role] < rank[minimum]) return denied("Institute access is required.", 403);
  return auth;
}
