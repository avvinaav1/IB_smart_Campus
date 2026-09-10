import type { NextRequest } from "next/server";
import { getDirectoryUser } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { followUser } from "@/lib/social-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : "";
  const target = await getDirectoryUser(targetUserId);
  if (!target) return noStoreJson({ error: "User not found." }, { status: 404 });
  const result = await followUser(userId, target.id, target.isPrivate);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: result }, { status: result.alreadyExisted ? 200 : 201 });
}
