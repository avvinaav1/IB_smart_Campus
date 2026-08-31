import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png)$/.test(filename)) notFound();
  try {
    const bytes = await readFile(/* turbopackIgnore: true */ path.join(process.cwd(), ".data", "uploads", filename));
    return new Response(bytes, { headers: { "Content-Type": filename.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    notFound();
  }
}
