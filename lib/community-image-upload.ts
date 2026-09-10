import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { authenticatedUserId, isSameOrigin, noStoreJson } from "@/lib/auth-http";
import { canManageCommunityBranding, updateCommunityImage } from "@/lib/community-store";
import { deleteImage, putImage } from "@/lib/image-storage";

const STORAGE_FOLDER = "community-uploads";

type ImageKind = "icon" | "banner";

const MIME_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const limits: Record<ImageKind, number> = {
  icon: 2 * 1024 * 1024,
  banner: 5 * 1024 * 1024,
};

function hasMatchingSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

async function removePreviousUpload(imageUrl: string) {
  const match = imageUrl.match(/^\/api\/communities\/images\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/);
  if (!match) return;
  await deleteImage(`${STORAGE_FOLDER}/${match[1]}`);
}

export async function uploadCommunityImage(request: NextRequest, communityId: string, kind: ImageKind) {
  if (!isSameOrigin(request)) return noStoreJson({ error: "Request origin was rejected." }, { status: 403 });
  const userId = await authenticatedUserId(request);
  if (!userId) return noStoreJson({ error: "Your session has expired." }, { status: 401 });
  const permission = await canManageCommunityBranding(communityId, userId);
  if ("error" in permission) return noStoreJson({ error: permission.error }, { status: permission.status });

  const form = await request.formData();
  const file = form.get(kind);
  const label = kind === "icon" ? "community icon" : "community banner";
  if (!(file instanceof File)) return noStoreJson({ error: `Choose a JPG, PNG, or WebP ${label}.` }, { status: 400 });
  if (!file.size) return noStoreJson({ error: `The selected ${label} is empty.` }, { status: 400 });
  if (file.size > limits[kind]) return noStoreJson({ error: `${kind === "icon" ? "Community icons" : "Community banners"} must be ${kind === "icon" ? "2" : "5"} MB or smaller.` }, { status: 413 });
  const extension = MIME_TO_EXTENSION.get(file.type);
  if (!extension) return noStoreJson({ error: "Only JPG, PNG, and WebP images are supported." }, { status: 415 });

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!hasMatchingSignature(bytes, file.type)) return noStoreJson({ error: "The uploaded file does not match its image type." }, { status: 415 });

  const filename = `${randomUUID()}.${extension}`;
  const objectPath = `${STORAGE_FOLDER}/${filename}`;
  await putImage(objectPath, bytes, file.type);

  const imageUrl = `/api/communities/images/${filename}`;
  const result = await updateCommunityImage(communityId, userId, kind, imageUrl);
  if ("error" in result) {
    await deleteImage(objectPath);
    return noStoreJson({ error: result.error }, { status: result.status });
  }
  await removePreviousUpload(result.previousUrl);
  return noStoreJson({ data: { community: result.community, imageUrl } }, { status: 201 });
}
