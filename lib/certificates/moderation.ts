import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/lib/firebase-admin";

function localDataStoreEnabled() {
  return process.env.NODE_ENV === "development" && process.env.LOCAL_DATA_STORE === "true";
}

async function updateQuery(collection: string, field: string, value: string, patch: Record<string, unknown>) {
  const page = await firestore().collection(collection).where(field, "==", value).get();
  if (page.empty) return;
  const writer = firestore().bulkWriter();
  for (const doc of page.docs) writer.update(doc.ref, patch);
  await writer.close();
}

export async function detachDeletedEventFromCertificates(eventId: string) {
  if (localDataStoreEnabled()) return;
  const patch = { eventId: FieldValue.delete() };
  await Promise.all([
    updateQuery("certificates", "eventId", eventId, patch),
    updateQuery("certificateJobs", "eventId", eventId, patch),
  ]);
}

export async function detachDeletedUserFromCertificates(userId: string) {
  if (localDataStoreEnabled()) return;
  const db = firestore();
  const [recipientPage, issuerPage, assetPage, jobPage, templatePage] = await Promise.all([
    db.collection("certificates").where("userId", "==", userId).get(),
    db.collection("certificates").where("issuerId", "==", userId).get(),
    db.collection("certificateAssets").where("ownerId", "==", userId).get(),
    db.collection("certificateJobs").where("organizerId", "==", userId).get(),
    db.collection("certificateTemplates").where("ownerId", "==", userId).get(),
  ]);

  const retainedAssetIds = new Set<string>();
  const writer = db.bulkWriter();
  for (const doc of recipientPage.docs) {
    if (doc.get("source") === "external") writer.delete(doc.ref);
    else {
      if (typeof doc.get("assetId") === "string") retainedAssetIds.add(doc.get("assetId"));
      writer.update(doc.ref, { userId: FieldValue.delete(), profileAwarded: false, visibility: "private" });
    }
  }
  for (const doc of issuerPage.docs) {
    if (typeof doc.get("assetId") === "string") retainedAssetIds.add(doc.get("assetId"));
    writer.update(doc.ref, { issuerId: FieldValue.delete() });
  }
  await writer.close();

  await Promise.all([
    db.recursiveDelete(db.collection("certificateInboxes").doc(userId)),
    db.collection("certificateProfiles").doc(userId).delete(),
    ...jobPage.docs.map((doc) => db.recursiveDelete(doc.ref)),
    ...templatePage.docs.map((doc) => db.recursiveDelete(doc.ref)),
  ]);

  for (const asset of assetPage.docs) {
    if (retainedAssetIds.has(asset.id)) {
      await asset.ref.update({ ownerId: "system" });
      continue;
    }
    const objectPath = asset.get("objectPath");
    if (typeof objectPath === "string") await db.recursiveDelete(db.collection(process.env.FIRESTORE_IMAGES_COLLECTION || "smartCampusImages").doc(objectPath.replaceAll("/", "__")));
    await asset.ref.delete();
  }
}
