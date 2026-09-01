import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { updateAvatar } from "@/lib/auth-store";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { putImage } from "@/lib/image-storage";

export const runtime = "nodejs";
const MAX_SIZE = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("avatar");
  if (!(file instanceof File)) return noStoreJson({ error: "Choose a JPG or PNG image." }, { status: 400 });
  if (file.size > MAX_SIZE) return noStoreJson({ error: "Profile picture must be 5 MB or smaller." }, { status: 413 });
  if (!new Set(["image/jpeg", "image/png"]).has(file.type)) return noStoreJson({ error: "Only JPG and PNG images are supported." }, { status: 415 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if ((file.type === "image/jpeg" && !isJpeg) || (file.type === "image/png" && !isPng)) return noStoreJson({ error: "The uploaded file is not a valid image." }, { status: 415 });
  const filename = `${randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  await putImage(`avatars/${filename}`, bytes, file.type);
  const result = await updateAvatar(userId, `/api/profile/avatar/${filename}`);
  return "error" in result ? noStoreJson({ error: result.error }, { status: 400 }) : noStoreJson({ data: result });
}

