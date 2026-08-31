import type { NextRequest } from "next/server";
import { uploadCommunityImage } from "@/lib/community-image-upload";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return uploadCommunityImage(request, id, "banner");
}
