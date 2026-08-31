import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";

export const runtime = "nodejs";
const MAX_SIZE = 5 * 1024 * 1024;
const MIME_TO_EXTENSION = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return noStoreJson({ error: "Choose a JPG, PNG, or WebP image." }, { status: 400 });
  if (!file.size) return noStoreJson({ error: "The selected image is empty." }, { status: 400 });
  if (file.size > MAX_SIZE) return noStoreJson({ error: "Event images must be 5 MB or smaller." }, { status: 413 });
  const extension = MIME_TO_EXTENSION.get(file.type);
  if (!extension) return noStoreJson({ error: "Only JPG, PNG, and WebP images are supported." }, { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if ((file.type === "image/jpeg" && !isJpeg) || (file.type === "image/png" && !isPng) || (file.type === "image/webp" && !isWebp)) {
    return noStoreJson({ error: "The uploaded file does not match its image type." }, { status: 415 });
  }
  const filename = `${randomUUID()}.${extension}`;
  const directory = path.join(process.cwd(), ".data", "event-uploads");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
  return noStoreJson({ data: { imageUrl: `/api/events/images/${filename}` } }, { status: 201 });
}
