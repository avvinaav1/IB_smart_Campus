import "server-only";
import type { Query } from "firebase-admin/firestore";
import { firestore } from "@/lib/firebase-admin";
import { getEventAttendeeUsers } from "@/lib/auth-store";

export type ClaimFilter = "all" | "claimed" | "pending";
export type AdminClaim = {
  id: string; email: string; title: string; issuerName: string; eventId: string | null; verificationCode: string | null;
  claimed: boolean; createdAt: number; claimedAt: number | null; claimedBy: { id: string; username: string } | null;
};

const count = async (query: Query) => (await query.count().get()).data().count;

// Aggregation queries bill one read per 1,000 index entries, so these stay
// cheap even though they scan whole collections.
export async function getCertificateStats(since: number) {
  const db = firestore();
  const claims = db.collection("certificateClaims"), certificates = db.collection("certificates"), jobs = db.collection("certificateJobs");
  const [claimsTotal, claimsClaimed, claimsRecent, active, internal, external, publicCount, issuedRecent, jobsTotal, jobsFailed] = await Promise.all([
    count(claims),
    count(claims.where("claimed", "==", true)),
    count(claims.where("createdAt", ">=", since)),
    count(certificates.where("status", "==", "active")),
    count(certificates.where("source", "==", "internal")),
    count(certificates.where("source", "==", "external")),
    count(certificates.where("visibility", "==", "public")),
    count(certificates.where("createdAt", ">=", since)),
    count(jobs),
    count(jobs.where("status", "in", ["failed", "completed_with_errors"])),
  ]);
  return {
    claims: { total: claimsTotal, claimed: claimsClaimed, pending: claimsTotal - claimsClaimed, newSince: claimsRecent },
    certificates: { active, internal, external, public: publicCount, newSince: issuedRecent },
    jobs: { total: jobsTotal, withErrors: jobsFailed },
  };
}

export async function listClaims(filter: ClaimFilter, limit: number, cursor?: string) {
  const collection = firestore().collection("certificateClaims");
  let query: Query = collection;
  if (filter !== "all") query = query.where("claimed", "==", filter === "claimed");
  query = query.orderBy("createdAt", "desc");
  if (cursor) { const snapshot = await collection.doc(cursor).get(); if (snapshot.exists) query = query.startAfter(snapshot); }
  const page = await query.limit(limit).get();
  const rows = page.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Record<string, unknown> & { id: string });
  const users = await getEventAttendeeUsers([...new Set(rows.map(row => row.claimedBy).filter((id): id is string => typeof id === "string"))]);
  const items: AdminClaim[] = rows.map(row => {
    const user = typeof row.claimedBy === "string" ? users.get(row.claimedBy) : undefined;
    return {
      id: row.id, email: String(row.email || ""), title: String(row.title || ""), issuerName: String(row.issuerName || ""),
      eventId: typeof row.eventId === "string" ? row.eventId : null, verificationCode: typeof row.verificationCode === "string" ? row.verificationCode : null,
      claimed: row.claimed === true, createdAt: Number(row.createdAt) || 0, claimedAt: typeof row.claimedAt === "number" ? row.claimedAt : null,
      claimedBy: typeof row.claimedBy === "string" ? { id: row.claimedBy, username: user?.username || "Deleted account" } : null,
    };
  });
  return { items, nextCursor: page.size === limit ? page.docs.at(-1)!.id : null };
}
