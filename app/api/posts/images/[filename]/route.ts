import { notFound } from "next/navigation";
import { contentTypeForFilename, getImage } from "@/lib/image-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,6}$/i.test(filename)) notFound();
  const bytes = await getImage(`post-uploads/${filename}`);
  if (!bytes) notFound();
  const contentType = contentTypeForFilename(filename);
  const isInline = contentType.startsWith("image/") || contentType === "application/pdf" || contentType.startsWith("video/");
  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": isInline ? "inline" : `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
