import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { putImage } from "@/lib/image-storage";

export const runtime = "nodejs";
const MAX_SIZE = 10 * 1024 * 1024;
const MIME_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/svg+xml", "svg"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["image/avif", "avif"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["application/json", "json"],
  ["application/zip", "zip"],
  ["text/csv", "csv"],
  ["application/msword", "doc"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
]);

export async function POST(request: NextRequest) {
  try {
    if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
    const userId = await authenticatedUserId(request);
    if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file") || form.get("image");
    if (!(file instanceof File)) return noStoreJson({ error: "Choose a file to upload." }, { status: 400 });
    if (!file.size) return noStoreJson({ error: "The selected file is empty." }, { status: 400 });
    if (file.size > MAX_SIZE) return noStoreJson({ error: "Uploaded files must be 10 MB or smaller." }, { status: 413 });
    
    // Extract extension from MIME or filename
    let extension = MIME_TO_EXTENSION.get(file.type);
    if (!extension) {
      const parts = file.name.split(".");
      if (parts.length > 1) {
        const candidate = parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
        if (candidate && candidate.length >= 2) extension = candidate;
      }
    }
    if (!extension) {
      extension = file.type.startsWith("image/") ? "jpg" : "bin";
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = `${randomUUID()}.${extension}`;
    await putImage(`post-uploads/${filename}`, bytes, file.type || "application/octet-stream");
    return noStoreJson({
      data: {
        imageUrl: `/api/posts/images/${filename}`,
        name: file.name,
        size: file.size,
        type: file.type,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Post image upload failed:", error);
    return noStoreJson({ error: error instanceof Error ? error.message : "Failed to upload file. Please try again." }, { status: 500 });
  }
}
