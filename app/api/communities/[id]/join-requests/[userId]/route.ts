import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { resolveJoinRequest } from "@/lib/community-store";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; userId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
    const ownerId = await authenticatedUserId(request);
    if (!ownerId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });

    const { id: communityId, userId: requesterId } = await context.params;
    const body = await readJson(request);
    const decision = body?.decision;

    if (decision !== "accepted" && decision !== "rejected") {
      return noStoreJson({ error: "Choose whether to accept or reject this request." }, { status: 400 });
    }

    const result = await resolveJoinRequest(communityId, ownerId, requesterId, decision);
    return "error" in result
      ? noStoreJson({ error: result.error }, { status: result.status })
      : noStoreJson({ data: result });
  } catch (error) {
    console.error("Join-request PATCH failed", error);
    return noStoreJson({ error: "Could not update the request." }, { status: 500 });
  }
}