import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { createPost, listPosts, type NewPostInput, validatePostInput } from "@/lib/post-store";

export const runtime = "nodejs";

async function authenticatedUser(request: NextRequest) {
  return getSession(request.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest) {
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { posts: await listPosts(user.id) } });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The post body is invalid." }, { status: 400 });
  if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every((image) => typeof image === "string"))) {
    return noStoreJson({ error: "Post images are invalid." }, { status: 400 });
  }
  const input: NewPostInput = {
    clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : "",
    communityId: typeof body.communityId === "string" ? body.communityId : "",
    flair: typeof body.flair === "string" ? body.flair : undefined,
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : undefined,
    images: Array.isArray(body.images) && body.images.every((image) => typeof image === "string") ? body.images : undefined,
  };
  const validationError = validatePostInput(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });
  const result = await createPost(user.id, user.username, input);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: 400 });
  return noStoreJson({ data: result }, { status: 201 });
}
