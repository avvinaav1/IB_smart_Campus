import { notFound } from "next/navigation";
import { getImage } from "@/lib/image-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(filename)) notFound();
  const bytes = await getImage(`avatars/${filename}`);
  if (!bytes) notFound();
  return new Response(bytes, { headers: { "Content-Type": filename.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
