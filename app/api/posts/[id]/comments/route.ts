import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-store";
import { isSameOrigin, noStoreJson, readJson, SESSION_COOKIE } from "@/lib/auth-http";
import { createComment, validateCommentBody } from "@/lib/post-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const user = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });

  const { id } = await context.params;
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) {
    return noStoreJson({ error: "That post is invalid." }, { status: 400 });
  }

  const payload = await readJson(request);
  const body = typeof payload?.body === "string" ? payload.body : "";
  const validationError = validateCommentBody(body);
  if (validationError) return noStoreJson({ error: validationError }, { status: 400 });

  const result = await createComment(postId, user.id, user.username, body);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: 404 });
  return noStoreJson({ data: result }, { status: 201 });
}
