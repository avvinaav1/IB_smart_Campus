import type { NextRequest } from "next/server";
import { getSession, incrementUserStreak } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { deleteOwnPost, getPostForOwner, updatePost, validatePostUpdate, type UpdatePostInput } from "@/lib/post-store";

export const runtime = "nodejs";

async function authenticatedUser(request: NextRequest) {
  return getSession(request.cookies.get(SESSION_COOKIE)?.value);
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return noStoreJson({ error: "That post is invalid." }, { status: 400 });
  }
  const result = await getPostForOwner(postId, user.id);
  return "error" in result
    ? noStoreJson({ error: result.error }, { status: result.status })
    : noStoreJson({ data: { post: result.post } });
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });

  const { id } = await context.params;
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return noStoreJson({ error: "That post is invalid." }, { status: 400 });
  }

  const body = await readJson(request);
  if (!body) return noStoreJson({ error: "The post body is invalid." }, { status: 400 });
  if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every((image) => typeof image === "string"))) {
    return noStoreJson({ error: "Post images are invalid." }, { status: 400 });
  }

  const input: UpdatePostInput = {
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : undefined,
    images: Array.isArray(body.images) && body.images.every((image) => typeof image === "string") ? body.images : undefined,
  };

  const validationError = validatePostUpdate(input);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });

  const result = await updatePost(postId, user.id, input);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });

  try { await incrementUserStreak(user.id, "POST_CREATE", String(postId)); } catch { /* ignore */ }
  return noStoreJson({ data: result });
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const user = await authenticatedUser(request);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });

  const { id } = await context.params;
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return noStoreJson({ error: "That post is invalid." }, { status: 400 });
  }

  const result = await deleteOwnPost(postId, user.id);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });

  // Best-effort image cleanup. If the storage helper isn't available, we skip.
  try {
    const mod = await import("@/lib/image-storage");
    const remove = (mod as { deleteImageUrl?: (url: string) => Promise<void> }).deleteImageUrl;
    if (remove) await Promise.all((result.imageUrls || []).map((url) => remove(url).catch(() => undefined)));
  } catch { /* ignore */ }

  return noStoreJson({ data: { deleted: true } });
}