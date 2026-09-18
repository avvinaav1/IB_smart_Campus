import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { getCommunityAccess, importCommunityIntoInstitute, reviewInstituteCommunity } from "@/lib/community-store";
import { attachCommunityEventsToInstitute } from "@/lib/event-store";
import { requireInstituteRole } from "@/lib/moderation-auth";
import { isGlobalModerator } from "@/lib/moderation-policy";
import type { CommunityStatus } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { id } = await context.params;
  const auth = await requireInstituteRole(request, id, "INSTITUTE_ADMIN");
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (!body || typeof body.communityId !== "string") return noStoreJson({ error: "Choose a community." }, { status: 400 });

  if (!isGlobalModerator(auth.user.appRole)) {
    const access = await getCommunityAccess(body.communityId, auth.user.id);
    if (!access || access.role !== "COMMUNITY_ADMIN") {
      return noStoreJson({ error: "You must be an admin of the community before importing it." }, { status: 403 });
    }
  }

  const result = await importCommunityIntoInstitute(body.communityId, id, auth.user.id);
  if (!("error" in result)) await attachCommunityEventsToInstitute(body.communityId, id);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: result });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const { id } = await context.params;
  const auth = await requireInstituteRole(request, id, "INSTITUTE_ADMIN");
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const status = body?.status as CommunityStatus;
  if (!body || typeof body.communityId !== "string" || (status !== "APPROVED" && status !== "REJECTED")) {
    return noStoreJson({ error: "Choose a community and review decision." }, { status: 400 });
  }
  const result = await reviewInstituteCommunity(id, body.communityId, auth.user.id, status);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: result });
}
