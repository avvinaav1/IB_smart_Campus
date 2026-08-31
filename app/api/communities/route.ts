import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { createCommunity, listCommunities, type CommunityPrivacy, type NewCommunityInput, validateCommunityInput } from "@/lib/community-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { communities: await listCommunities(userId) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The community body is invalid." }, { status: 400 });
  const input: NewCommunityInput = {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : "",
    color: typeof body.color === "string" ? body.color : "",
    emoji: typeof body.emoji === "string" ? body.emoji : "",
    privacy: typeof body.privacy === "string" ? body.privacy as CommunityPrivacy : "public",
  };
  const validationError = validateCommunityInput(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const result = await createCommunity(userId, input);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 409 }) : noStoreJson({ data: result }, { status: 201 });
}
