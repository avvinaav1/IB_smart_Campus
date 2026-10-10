import type { NextRequest } from "next/server";
import { authenticatedUserId, noStoreJson } from "@/lib/auth-http";
import { getCommunityInvite } from "@/lib/community-store";
import { communityInvitePath } from "@/lib/community-invite-link";
import { communityInviteQrPng, communityInviteQrSvg } from "@/lib/qr";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";

// GET /api/communities/:id/invite/qr              -> invite QR as SVG (admins/moderators only)
// GET /api/communities/:id/invite/qr?format=png   -> 1024px PNG
// Add &download=1 to receive it as an attachment.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const { id } = await context.params;
  const result = await getCommunityInvite(id, userId);
  if ("error" in result) return noStoreJson({ error: result.error }, { status: result.status });

  const url = `${SITE_URL}${communityInvitePath(id, result.token)}`;
  const png = request.nextUrl.searchParams.get("format") === "png";
  const headers: Record<string, string> = {
    "Content-Type": png ? "image/png" : "image/svg+xml; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (request.nextUrl.searchParams.get("download") === "1") {
    const slug = result.community.name.replace(/^c\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "community";
    headers["Content-Disposition"] = `attachment; filename="${slug}-invite-qr.${png ? "png" : "svg"}"`;
  }
  const body = png ? new Uint8Array(await communityInviteQrPng(url)) : await communityInviteQrSvg(url);
  return new Response(body, { headers });
}
