import type { NextRequest } from "next/server";
import { getSession, searchUsers } from "@/lib/auth-store";
import { noStoreJson, SESSION_COOKIE } from "@/lib/auth-http";
import { getRelationshipStates } from "@/lib/social-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const query = request.nextUrl.searchParams.get("q")?.trim() || "";
  if (!query || query.length > 50) return noStoreJson({ data: { users: [] } });
  const users = await searchUsers(user.id, query);
  const relationships = await getRelationshipStates(user.id, users.map((candidate) => candidate.id));
  return noStoreJson({ data: { users: users.map((candidate) => ({ ...candidate, ...relationships[candidate.id] })) } });
}
