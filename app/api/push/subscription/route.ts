import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { pushPublicKey, removePushSubscription, savePushSubscription, validPushSubscription } from "@/lib/push-store";

export const runtime = "nodejs";

/** The VAPID public key browsers need to subscribe; empty when push isn't configured. */
export async function GET(request: NextRequest) {
  if (!(await authenticatedUserId(request))) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  return noStoreJson({ data: { publicKey: pushPublicKey() } });
}

/** Body: a PushSubscription's JSON (`{ endpoint, keys: { p256dh, auth } }`). */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  if (!pushPublicKey()) return noStoreJson({ error: "Push notifications are not configured on this server." }, { status: 503 });
  const body = await readJson(request);
  if (!validPushSubscription(body)) return noStoreJson({ error: "The push subscription is invalid." }, { status: 400 });
  await savePushSubscription(userId, body);
  return noStoreJson({ data: { subscribed: true } }, { status: 201 });
}

/** Body: `{ endpoint }` — stop pushing to this device. */
export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const body = await readJson(request);
  if (typeof body?.endpoint !== "string") return noStoreJson({ error: "Missing endpoint." }, { status: 400 });
  await removePushSubscription(userId, body.endpoint);
  return noStoreJson({ data: { subscribed: false } });
}
