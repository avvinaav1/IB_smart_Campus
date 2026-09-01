import type { NextRequest } from "next/server";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { getAttendeeCheckIn, getViewerCheckIn } from "@/lib/event-store";
import { checkInCodeSvg } from "@/lib/qr";

export const runtime = "nodejs";

// GET /api/events/:id/ticket-qr        -> the caller's own attendance QR (SVG)
// GET /api/events/:id/ticket-qr?rsvpId= -> a specific attendee's QR (managers only)
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const rsvpId = request.nextUrl.searchParams.get("rsvpId");

  let code: string | null = null;
  if (rsvpId) {
    const result = await getAttendeeCheckIn(id, userId, rsvpId);
    if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });
    code = result.checkInCode;
  } else {
    const ticket = await getViewerCheckIn(id, userId);
    if (!ticket) return noStoreJson({ error: "You have not registered for this event." }, { status: 404 });
    code = ticket.checkInCode;
  }

  const svg = await checkInCodeSvg(code);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
