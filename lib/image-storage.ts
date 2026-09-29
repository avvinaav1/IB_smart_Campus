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

  const batch = db.batch();
  let chunkCount = 0;
  for (let offset = 0; offset < source.length; offset += CHUNK_BYTES) {
    const slice = source.subarray(offset, offset + CHUNK_BYTES);
    batch.set(ref.collection("chunks").doc(String(chunkCount).padStart(4, "0")), { data: slice.toString("base64") });
    chunkCount += 1;
  }
  batch.set(ref, { contentType, size: source.length, chunkCount, path: objectPath, updatedAt: Date.now() });
  await batch.commit();
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
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
