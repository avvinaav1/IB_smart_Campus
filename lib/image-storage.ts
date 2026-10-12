import "server-only";

import { firestore } from "@/lib/firebase-admin";
import { dedupe, LruCache } from "@/lib/memory-cache";

/**
 * The free Firebase plan has no Cloud Storage, so uploaded images live in
 * Firestore instead. Each image is one document plus a `chunks` subcollection
 * holding base64 slices of at most CHUNK_BYTES raw bytes, keeping every document
 * well under Firestore's 1 MiB limit. The public URL scheme served by the app
 * stays `/api/<kind>/images/<uuid.ext>` — only the bytes move.
 */
const IMAGES_COLLECTION = process.env.FIRESTORE_IMAGES_COLLECTION || "smartCampusImages";
const CHUNK_BYTES = 700_000;
// Every chunk read is billed, and the same avatar/cover is served to every
// viewer, so keep recently served images in memory (default 64 MB).
const imageCache = new LruCache<Uint8Array<ArrayBuffer>>(Math.max(0, Number(process.env.IMAGE_CACHE_MAX_BYTES ?? 64 * 1024 * 1024)), (bytes) => bytes.byteLength);
const imageReads = dedupe<Uint8Array<ArrayBuffer> | null>();

function docId(objectPath: string) {
  return objectPath.replace(/\//g, "__");
}

export async function putImage(objectPath: string, bytes: Buffer | Uint8Array, contentType: string) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const db = firestore();
  const ref = db.collection(IMAGES_COLLECTION).doc(docId(objectPath));

  // Replace any previous chunks for this id before writing the new ones.
  await deleteImage(objectPath);

  const chunkDocs: { id: string; data: string }[] = [];
  let chunkCount = 0;
  for (let offset = 0; offset < source.length; offset += CHUNK_BYTES) {
    const slice = source.subarray(offset, offset + CHUNK_BYTES);
    chunkDocs.push({
      id: String(chunkCount).padStart(4, "0"),
      data: slice.toString("base64"),
    });
    chunkCount += 1;
  }

  // Commit chunks in batches of 3 to guarantee we stay safely below Firestore's 10 MiB batch request limit
  const BATCH_CHUNK_LIMIT = 3;
  for (let i = 0; i < chunkDocs.length; i += BATCH_CHUNK_LIMIT) {
    const batch = db.batch();
    const group = chunkDocs.slice(i, i + BATCH_CHUNK_LIMIT);
    for (const chunk of group) {
      batch.set(ref.collection("chunks").doc(chunk.id), { data: chunk.data });
    }
    await batch.commit();
  }

  await ref.set({ contentType, size: source.length, chunkCount, path: objectPath, updatedAt: Date.now() });
  imageCache.delete(objectPath);
}

export async function getImage(objectPath: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const cached = imageCache.get(objectPath);
  if (cached) return cached;
  return imageReads(objectPath, async () => {
    // The chunks alone tell us whether the image exists; skipping the metadata
    // doc saves a read per image.
    const ref = firestore().collection(IMAGES_COLLECTION).doc(docId(objectPath));
    const chunks = await ref.collection("chunks").orderBy("__name__").get();
    if (chunks.empty) return null;
    const buffer = Buffer.concat(chunks.docs.map((chunk) => Buffer.from(chunk.get("data") as string, "base64")));
    const copy = new Uint8Array(buffer.length);
    copy.set(buffer);
    imageCache.set(objectPath, copy);
    return copy;
  });
}

export async function deleteImage(objectPath: string) {
  imageCache.delete(objectPath);
  try {
    const db = firestore();
    const ref = db.collection(IMAGES_COLLECTION).doc(docId(objectPath));
    const chunks = await ref.collection("chunks").get();
    if (!chunks.empty || (await ref.get()).exists) {
      const batch = db.batch();
      for (const chunk of chunks.docs) batch.delete(chunk.ref);
      batch.delete(ref);
      await batch.commit();
    }
  } catch {
    // best-effort cleanup
  }
}

export function contentTypeForFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}
