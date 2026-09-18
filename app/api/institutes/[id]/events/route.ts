import type { NextRequest } from "next/server";
import { isSameOrigin, noStoreJson, readJson } from "@/lib/auth-http";
import { listPendingInstituteEvents, reviewInstituteEvent } from "@/lib/event-store";
import { requireInstituteRole } from "@/lib/moderation-auth";
import type { EventStatus } from "@/lib/types";

export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; const auth = await requireInstituteRole(request, id, "INSTITUTE_MODERATOR"); if ("response" in auth) return auth.response; return noStoreJson({ data: { events: await listPendingInstituteEvents(id, auth.user.id) } }); }
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) { if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 }); const { id } = await context.params; const auth = await requireInstituteRole(request, id, "INSTITUTE_MODERATOR"); if ("response" in auth) return auth.response; const body = await readJson(request); const status = body?.status as Extract<EventStatus, "APPROVED" | "REJECTED">; if (!body || typeof body.eventId !== "string" || (status !== "APPROVED" && status !== "REJECTED")) return noStoreJson({ error: "Choose an event and status." }, { status: 400 }); const result = await reviewInstituteEvent(id, body.eventId, auth.user.id, status); return "error" in result ? noStoreJson({ error: result.error }, { status: result.status }) : noStoreJson({ data: result }); }
