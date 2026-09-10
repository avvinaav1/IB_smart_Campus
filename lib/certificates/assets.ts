import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { firestore } from "@/lib/firebase-admin";

export type Asset = { id: string; ownerId: string; kind: "background" | "import" | "certificate" | "archive"; contentType: string; byteSize: number; sha256: string; objectPath: string; state: "ready"; createdAt: number; jobId?: string };
const CHUNK = 700_000;
const images = () => firestore().collection(process.env.FIRESTORE_IMAGES_COLLECTION || "smartCampusImages");
export async function saveAsset(ownerId: string, kind: Asset["kind"], input: Uint8Array | string, contentType: string, jobId?: string) {
  const id = randomUUID(), objectPath = `certificates/${id}`;
  const meta = firestore().collection("certificateAssets").doc(id);
  await meta.set({ schemaVersion: 1, ownerId, kind, objectPath, contentType, state: "uploading", createdAt: Date.now() });
  const ref = images().doc(objectPath.replaceAll("/", "__"));
  const source = typeof input === "string" ? createReadStream(input, { highWaterMark: CHUNK }) : (async function* () { for (let offset = 0; offset < input.length; offset += CHUNK) yield input.subarray(offset, offset + CHUNK); })();
  let size = 0, chunks = 0;
  const hash = createHash("sha256");
  try {
    for await (const raw of source) {
      const bytes = Buffer.from(raw); size += bytes.length;
      if (size > (kind === "archive" ? 512 * 1024 * 1024 : 16 * 1024 * 1024)) throw new Error("Artifact exceeds its storage limit");
      hash.update(bytes);
      await ref.collection("chunks").doc(String(chunks++).padStart(6, "0")).set({ data: bytes.toString("base64") });
    }
    await ref.set({ contentType, size, chunkCount: chunks, path: objectPath, updatedAt: Date.now() });
    const asset: Asset = { id, ownerId, kind, contentType, byteSize: size, sha256: hash.digest("hex"), objectPath, state: "ready", createdAt: Date.now(), ...(jobId ? { jobId } : {}) };
    await meta.set({ ...asset, schemaVersion: 1 });
    return asset;
  } catch (error) { await meta.update({ state: "failed" }); throw error; }
}
export async function getAsset(id: string): Promise<Asset | null> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;
  const doc = await firestore().collection("certificateAssets").doc(id).get();
  return doc.exists && doc.get("state") === "ready" ? { ...doc.data(), id: doc.id } as Asset : null;
}
export async function* assetChunks(asset: Asset) {
  const ref = images().doc(asset.objectPath.replaceAll("/", "__")).collection("chunks");
  let cursor: string | undefined;
  let size = 0;
  while (true) {
    let query = ref.orderBy("__name__").limit(8);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) { const bytes = Buffer.from(doc.get("data"), "base64"); size += bytes.length; yield bytes; cursor = doc.id; }
    if (page.size < 8) break;
  }
  if (size !== asset.byteSize) throw new Error("Artifact data is incomplete");
}
export async function assetBytes(asset: Asset) { const chunks: Buffer[] = []; for await (const chunk of assetChunks(asset)) chunks.push(chunk); return Buffer.concat(chunks); }
