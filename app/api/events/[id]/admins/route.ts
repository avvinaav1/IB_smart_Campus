import type { NextRequest } from "next/server";
import { getDirectoryUser, getDirectoryUsers } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { addEventAdmin, listEventAdminsForManager } from "@/lib/event-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const result = await listEventAdminsForManager(id, userId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  const users = await getDirectoryUsers(result.admins.map((admin) => admin.userId));
  const admins = result.admins.flatMap((admin) => {
    const user = users.get(admin.userId);
    return user ? [{ id: admin.id, userId: user.id, username: user.username, avatarUrl: user.avatarUrl, createdAt: admin.createdAt }] : [];
  });
  return noStoreJson({ data: { admins, isCreator: result.isCreator } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const creatorId = await authenticatedUserId(request);
  if (!creatorId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await params;
  const access = await listEventAdminsForManager(id, creatorId);
  if ("error" in access) return noStoreJson({ error: access.error }, { status: access.status });
  if (!access.isCreator) return noStoreJson({ error: "Only the event creator can add administrators." }, { status: 403 });
  const body = await readJson(request);
  const adminUserId = typeof body?.userId === "string" ? body.userId : "";
  if (!adminUserId) return noStoreJson({ error: "Choose a user to add." }, { status: 400 });
  const user = await getDirectoryUser(adminUserId);
  if (!user) return noStoreJson({ error: "That user no longer exists." }, { status: 404 });
  const result = await addEventAdmin(id, creatorId, adminUserId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
  return noStoreJson({ data: { admin: { id: result.admin.id, userId: user.id, username: user.username, avatarUrl: user.avatarUrl, createdAt: result.admin.createdAt } } }, { status: 201 });
}
