import type { AppRole, CommunityRole, EventStatus, InstituteRole } from "@/lib/types";

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

export function canManageInstitutes(appRole: AppRole) {
  return isGlobalModerator(appRole);
}

export function isInstituteModerator(role?: InstituteRole) {
  return role === "INSTITUTE_ADMIN" || role === "INSTITUTE_MODERATOR";
}

export function canApproveInstituteEvent(appRole: AppRole, instituteRole?: InstituteRole) {
  return isGlobalModerator(appRole) || instituteRole === "INSTITUTE_ADMIN" || instituteRole === "INSTITUTE_MODERATOR";
}

export function canApproveInstituteCommunityEvent(appRole: AppRole, instituteRole?: InstituteRole, communityRole?: CommunityRole) {
  return isGlobalModerator(appRole) || instituteRole === "INSTITUTE_ADMIN" || instituteRole === "INSTITUTE_MODERATOR" || communityRole === "COMMUNITY_ADMIN";
}

export function canCreateInstituteContent(appRole: AppRole, instituteRole?: InstituteRole) {
  return isGlobalModerator(appRole) || instituteRole === "INSTITUTE_ADMIN" || instituteRole === "INSTITUTE_MODERATOR" || instituteRole === "INSTITUTE_MEMBER";
}

export function canDelegateAppRoles(appRole: AppRole) {
  return appRole === "SUPER_ADMIN";
}

export function canManageCertificates(appRole: AppRole, instituteRole?: InstituteRole) {
  return isGlobalModerator(appRole) || instituteRole === "INSTITUTE_ADMIN";
}

export function canManageEventAttendance(appRole: AppRole, isCreator: boolean, isEventAdmin: boolean) {
  return isGlobalModerator(appRole) || isCreator || isEventAdmin;
}

export function isScopedCommunityModerator(appRole: AppRole, communityRole?: CommunityRole) {
  return isGlobalModerator(appRole) || communityRole === "COMMUNITY_ADMIN" || communityRole === "COMMUNITY_MODERATOR";
}
