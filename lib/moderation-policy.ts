import type { AppRole, CommunityRole, EventStatus } from "@/lib/types";

export const SUPER_ADMIN_USERNAME = "kavinav75";

export function isProtectedSuperAdminUsername(username: string) {
  return username.trim().toLowerCase() === SUPER_ADMIN_USERNAME;
}

export function normalizeAppRole(username: string, storedRole: unknown): AppRole {
  if (isProtectedSuperAdminUsername(username)) return "SUPER_ADMIN";
  return storedRole === "APP_MODERATOR" ? "APP_MODERATOR" : "USER";
}

export function normalizeCommunityRole(storedRole: unknown): CommunityRole {
  if (storedRole === "ADMIN") return "COMMUNITY_ADMIN";
  if (storedRole === "COMMUNITY_ADMIN" || storedRole === "COMMUNITY_MODERATOR") return storedRole;
  return "MEMBER";
}

export function normalizeEventStatus(storedStatus: unknown): EventStatus {
  return storedStatus === "PENDING" || storedStatus === "REJECTED" ? storedStatus : "APPROVED";
}

export function eventStatusForCommunity(communityId?: string | null): EventStatus {
  return communityId ? "PENDING" : "APPROVED";
}

export function isGlobalModerator(appRole: AppRole) {
  return appRole === "APP_MODERATOR" || appRole === "SUPER_ADMIN";
}

export function canDelegateAppRoles(appRole: AppRole) {
  return appRole === "SUPER_ADMIN";
}

export function isScopedCommunityModerator(appRole: AppRole, communityRole?: CommunityRole) {
  return isGlobalModerator(appRole) || communityRole === "COMMUNITY_ADMIN" || communityRole === "COMMUNITY_MODERATOR";
}
