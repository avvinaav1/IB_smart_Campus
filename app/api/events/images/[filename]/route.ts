import { notFound } from "next/navigation";
import { contentTypeForFilename, getImage } from "@/lib/image-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename)) notFound();
  const bytes = await getImage(`event-uploads/${filename}`);
  if (!bytes) notFound();
  return new Response(bytes, { headers: { "Content-Type": contentTypeForFilename(filename), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
