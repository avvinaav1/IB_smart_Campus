import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(filename)) notFound();
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ path.join(process.env.VERCEL ? "/tmp" : process.cwd(), ".data", "community-uploads", filename));
    const contentType = filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    notFound();
  }
}
