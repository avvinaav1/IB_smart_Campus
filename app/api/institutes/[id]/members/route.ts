import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { getDirectoryUser, getDirectoryUsers } from "@/lib/auth-store";
import { getInstitute, listInstituteMembers, setInstituteMember, removeInstituteMember, isInstituteRole } from "@/lib/institute-store";
import { requireInstituteRole } from "@/lib/moderation-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; const auth = await requireInstituteRole(request, id); if ("response" in auth) return auth.response; const records = await listInstituteMembers(id); const usersById = await getDirectoryUsers(records.map(member => member.userId)); return noStoreJson({ data: { members: records.map(member => ({ ...member, username: usersById.get(member.userId)?.username || member.userId, avatarUrl: usersById.get(member.userId)?.avatarUrl || "" })) } }); }
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 }); const { id } = await context.params; const auth = await requireInstituteRole(request, id, "INSTITUTE_ADMIN"); if ("response" in auth) return auth.response;
  const body = await readJson(request); if (!body || typeof body.userId !== "string" || !isInstituteRole(body.role)) return noStoreJson({ error: "Choose a user and valid Institute role." }, { status: 400 });
  if (!await getInstitute(id) || !await getDirectoryUser(body.userId)) return noStoreJson({ error: "Institute or user not found." }, { status: 404 }); const result = await setInstituteMember(id, auth.user.id, body.userId, body.role, auth.user.appRole === "SUPER_ADMIN" || auth.user.appRole === "APP_MODERATOR"); return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }, { status: 201 });
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 }); const { id } = await context.params; const auth = await requireInstituteRole(request, id, "INSTITUTE_ADMIN"); if ("response" in auth) return auth.response; const userId = new URL(request.url).searchParams.get("userId"); if (!userId) return noStoreJson({ error: "Choose a member." }, { status: 400 }); const result = await removeInstituteMember(id, auth.user.id, userId, auth.user.appRole === "SUPER_ADMIN" || auth.user.appRole === "APP_MODERATOR"); return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result });
}
