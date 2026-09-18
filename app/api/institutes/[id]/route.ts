import type { NextRequest } from "next/server";
import { noStoreJson } from "@/lib/auth-http";
import { getDirectoryUsers } from "@/lib/auth-store";
import { listInstituteCommunities, listPendingInstituteCommunities } from "@/lib/community-store";
import { listPendingInstituteEvents } from "@/lib/event-store";
import { getInstitute, getInstituteMembership, listInstituteMembers } from "@/lib/institute-store";
import { requireInstituteRole } from "@/lib/moderation-auth";
import { isGlobalModerator } from "@/lib/moderation-policy";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireInstituteRole(request, id, "INSTITUTE_MEMBER");
  if ("response" in auth) return auth.response;

  const institute = await getInstitute(id);
  if (!institute) return noStoreJson({ error: "Institute not found." }, { status: 404 });

  const membership = await getInstituteMembership(id, auth.user.id);
  const canApprove = isGlobalModerator(auth.user.appRole) || membership?.role === "INSTITUTE_ADMIN";
  const canApproveEvents = canApprove || membership?.role === "INSTITUTE_MODERATOR";
  const [memberRecords, communities, pendingCommunities, pendingEvents] = await Promise.all([
    listInstituteMembers(id),
    listInstituteCommunities(id, auth.user.id, canApprove),
    canApprove ? listPendingInstituteCommunities(id, auth.user.id) : Promise.resolve([]),
    canApproveEvents ? listPendingInstituteEvents(id, auth.user.id) : Promise.resolve([]),
  ]);
  const usersById = await getDirectoryUsers(memberRecords.map((member) => member.userId));
  const members = memberRecords.map((member) => ({
    ...member,
    username: usersById.get(member.userId)?.username || member.userId,
    avatarUrl: usersById.get(member.userId)?.avatarUrl || "",
  }));

  return noStoreJson({
    data: { institute, role: membership?.role || null, canApprove, canApproveEvents, members, communities, pendingCommunities, pendingEvents },
  });
}
