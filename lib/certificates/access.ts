import "server-only";

import type { SessionUser } from "@/lib/types";
import { hasInstituteAdminRole } from "@/lib/institute-store";
import { canManageCertificates } from "@/lib/moderation-policy";

export async function mayManageCertificates(user: SessionUser) {
  if (canManageCertificates(user.appRole)) return true;
  return canManageCertificates(user.appRole, await hasInstituteAdminRole(user.id) ? "INSTITUTE_ADMIN" : undefined);
}
