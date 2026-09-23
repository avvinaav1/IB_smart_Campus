import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { getPublicEvent } from "@/lib/event-store";
import { getImage } from "@/lib/image-storage";

export const runtime = "nodejs";

// Link-preview size recommended by WhatsApp, Facebook, LinkedIn and X.
const WIDTH = 1200;
const HEIGHT = 630;

async function coverBytes(imageUrl: string) {
  const uploaded = imageUrl.match(/^\/api\/events\/images\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/);
  if (uploaded) return getImage(`event-uploads/${uploaded[1]}`);
  const builtIn = imageUrl.match(/^\/([a-z0-9-]+\.svg)$/);
  if (builtIn) return readFile(path.join(process.cwd(), "public", builtIn[1])).catch(() => null);
  return null;
}

/**
 * The event's cover as a 1200×630 JPEG, used as the og:image on the public
 * event page and as the image attached when sharing. Social crawlers reject
 * SVG and very large files, and robots.txt blocks /api/, so the raw cover URL
 * can't be used directly.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await getPublicEvent(id);
  const source = event ? await coverBytes(event.imageUrl) : null;
  if (!event || !source) return new Response("Not found", { status: 404 });

  const image = sharp(source, { density: 200 }).rotate();
  let pipeline: Sharp;
  if (event.coverFit === "fit") {
    pipeline = image.resize(WIDTH, HEIGHT, { fit: "contain", background: "#14121a" });
  } else {
    // Crop to 1200×630 around the creator's focal point, as the app displays it.
    const meta = await sharp(source, { density: 200 }).metadata();
    const rotated = (meta.orientation ?? 1) >= 5; // EXIF orientations 5–8 swap width/height
    const width = (rotated ? meta.height : meta.width) || WIDTH;
    const height = (rotated ? meta.width : meta.height) || HEIGHT;
    const scale = Math.max(WIDTH / width, HEIGHT / height);
    const cropWidth = Math.min(width, Math.round(WIDTH / scale));
    const cropHeight = Math.min(height, Math.round(HEIGHT / scale));
    const left = Math.round((width - cropWidth) * (event.coverFocusX / 100));
    const top = Math.round((height - cropHeight) * (event.coverFocusY / 100));
    pipeline = image.extract({ left, top, width: cropWidth, height: cropHeight }).resize(WIDTH, HEIGHT);
  }
  const jpeg = await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Disposition": `inline; filename="event-banner.jpg"`,
      // Short cache: the creator can change the cover or focal point.
      "Cache-Control": "public, max-age=600, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
