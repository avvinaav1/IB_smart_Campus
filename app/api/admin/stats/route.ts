import type { NextRequest } from "next/server";
import { getUserStats } from "@/lib/auth-store";
import { noStoreJson } from "@/lib/auth-http";
import { getCertificateStats } from "@/lib/certificates/admin-stats";
import { getCommunityStats } from "@/lib/community-store";
import { getEventStats } from "@/lib/event-store";
import { requireGlobalModerator } from "@/lib/moderation-auth";
import { getPostStats } from "@/lib/post-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireGlobalModerator(request);
  if ("response" in auth) return auth.response;
  const now = Date.now(), since = now - 7 * 24 * 60 * 60 * 1000;
  const [users, communities, events, posts, certificates] = await Promise.all([
    getUserStats(now),
    getCommunityStats(since),
    getEventStats(since, now),
    getPostStats(since),
    getCertificateStats(since).catch((error) => {
      console.error("Certificate stats unavailable", { code: (error as { code?: unknown }).code ?? "unavailable" });
      return null;
    }),
  ]);
  return noStoreJson({ data: { generatedAt: now, users, communities, events, posts, certificates } });
}
