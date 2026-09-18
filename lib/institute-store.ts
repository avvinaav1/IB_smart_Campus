import "server-only";

import { randomUUID } from "node:crypto";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import type { Institute, InstituteRole } from "@/lib/types";

export type { Institute } from "@/lib/types";
export type InstituteMember = { id: string; instituteId: string; userId: string; role: InstituteRole; createdAt: number; updatedAt: number };
type Database = { version: 1; institutes: Record<string, Institute>; members: Record<string, InstituteMember>; memberIndex: Record<string, string> };
const STORE_DOC = process.env.INSTITUTES_STORE_DOC || "institutes";
let writeQueue: Promise<unknown> = Promise.resolve();

function key(instituteId: string, userId: string) { return `${instituteId}:${userId}`; }
function hydrate(value: Partial<Database> | null): Database {
  const database: Database = { version: 1, institutes: value?.institutes || {}, members: value?.members || {}, memberIndex: value?.memberIndex || {} };
  for (const member of Object.values(database.members)) database.memberIndex[key(member.instituteId, member.userId)] = member.id;
  return database;
}
async function load() { return hydrate(await readDocument<Partial<Database>>(STORE_DOC)); }
function mutate<T>(action: (database: Database) => T | Promise<T>) {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<Database>, Database>(STORE_DOC, async current => { const database = hydrate(current); result = await action(database); return database; });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function isInstituteRole(value: unknown): value is InstituteRole { return value === "INSTITUTE_MEMBER" || value === "INSTITUTE_ADMIN" || value === "INSTITUTE_MODERATOR"; }
export async function createInstitute(actorId: string, name: string, description: string) {
  return mutate(database => {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) return { error: "Institute names must be 2–120 characters.", status: 400 } as const;
    if (description.trim().length > 500) return { error: "Institute descriptions must be 500 characters or fewer.", status: 400 } as const;
    if (Object.values(database.institutes).some(item => item.name.toLowerCase() === trimmed.toLowerCase())) return { error: "That institute name is already taken.", status: 409 } as const;
    const now = Date.now(), institute: Institute = { id: randomUUID(), name: trimmed, description: description.trim(), createdBy: actorId, createdAt: now, updatedAt: now };
    database.institutes[institute.id] = institute;
    const member: InstituteMember = { id: randomUUID(), instituteId: institute.id, userId: actorId, role: "INSTITUTE_ADMIN", createdAt: now, updatedAt: now };
    database.members[member.id] = member; database.memberIndex[key(institute.id, actorId)] = member.id;
    return { institute, member } as const;
  });
}
export async function getInstitute(instituteId: string) { await writeQueue; return (await load()).institutes[instituteId] || null; }
export async function listInstitutes(viewerId: string) {
  await writeQueue;
  const db = await load();
  return Object.values(db.institutes)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(institute => {
      const memberId = db.memberIndex[key(institute.id, viewerId)];
      return { ...institute, role: memberId ? db.members[memberId]?.role || null : null };
    });
}
export async function listInstitutesForUser(userId: string) { await writeQueue; const db = await load(); const ids = new Set(Object.values(db.members).filter(m => m.userId === userId).map(m => m.instituteId)); return Object.values(db.institutes).filter(i => ids.has(i.id)); }
export async function getInstituteMembership(instituteId: string, userId: string) { await writeQueue; const db = await load(); const id = db.memberIndex[key(instituteId, userId)]; return id ? db.members[id] || null : null; }
export async function listInstituteMembers(instituteId: string) { await writeQueue; const db = await load(); return Object.values(db.members).filter(m => m.instituteId === instituteId).sort((a, b) => a.createdAt - b.createdAt); }
export async function joinInstitute(instituteId: string, userId: string) {
  return mutate(db => {
    if (!db.institutes[instituteId]) return { error: "Institute not found.", status: 404 } as const;
    const existingId = db.memberIndex[key(instituteId, userId)];
    if (existingId) return { member: db.members[existingId], alreadyJoined: true } as const;
    const now = Date.now();
    const member: InstituteMember = { id: randomUUID(), instituteId, userId, role: "INSTITUTE_MEMBER", createdAt: now, updatedAt: now };
    db.members[member.id] = member; db.memberIndex[key(instituteId, userId)] = member.id;
    return { member, alreadyJoined: false } as const;
  });
}
export async function leaveInstitute(instituteId: string, userId: string) {
  return mutate(db => {
    const memberId = db.memberIndex[key(instituteId, userId)], member = memberId ? db.members[memberId] : undefined;
    if (!member) return { error: "You are not a member of this Institute.", status: 404 } as const;
    if (member.role !== "INSTITUTE_MEMBER") return { error: "Institute admins and moderators must be removed by an Institute admin.", status: 403 } as const;
    delete db.members[member.id]; delete db.memberIndex[key(instituteId, userId)];
    return { removed: true } as const;
  });
}
export async function setInstituteMember(instituteId: string, actorId: string, userId: string, role: InstituteRole, global = false) {
  return mutate(db => {
    if (!db.institutes[instituteId]) return { error: "Institute not found.", status: 404 } as const;
    if (role === "INSTITUTE_ADMIN" && !global) return { error: "Only a global moderator can assign Institute Admin.", status: 403 } as const;
    const actorIdKey = db.memberIndex[key(instituteId, actorId)], actor = actorIdKey ? db.members[actorIdKey] : undefined;
    if (!global && (!actor || actor.role !== "INSTITUTE_ADMIN")) return { error: "Institute admin access is required.", status: 403 } as const;
    const existingId = db.memberIndex[key(instituteId, userId)];
    if (existingId) {
      const existing = db.members[existingId];
      if (existing.role === "INSTITUTE_ADMIN" && role !== "INSTITUTE_ADMIN" && Object.values(db.members).filter(m => m.instituteId === instituteId && m.role === "INSTITUTE_ADMIN").length <= 1) {
        return { error: "An institute must retain an admin.", status: 400 } as const;
      }
      existing.role = role; existing.updatedAt = Date.now(); return { member: existing } as const;
    }
    const now = Date.now(), member: InstituteMember = { id: randomUUID(), instituteId, userId, role, createdAt: now, updatedAt: now };
    db.members[member.id] = member; db.memberIndex[key(instituteId, userId)] = member.id; return { member } as const;
  });
}
export async function removeInstituteMember(instituteId: string, actorId: string, userId: string, global = false) {
  return mutate(db => {
    const actor = db.members[db.memberIndex[key(instituteId, actorId)] || ""], memberId = db.memberIndex[key(instituteId, userId)];
    if (!global && (!actor || actor.role !== "INSTITUTE_ADMIN")) return { error: "Institute admin access is required.", status: 403 } as const;
    const member = memberId ? db.members[memberId] : undefined;
    if (!member) return { error: "Institute member not found.", status: 404 } as const;
    if (member.role === "INSTITUTE_ADMIN" && !global) return { error: "Only a global moderator can remove an Institute Admin.", status: 403 } as const;
    if (member.role === "INSTITUTE_ADMIN" && Object.values(db.members).filter(m => m.instituteId === instituteId && m.role === "INSTITUTE_ADMIN").length <= 1) return { error: "An institute must retain an admin.", status: 400 } as const;
    delete db.members[member.id]; delete db.memberIndex[key(instituteId, userId)]; return { removed: true } as const;
  });
}
export async function authorizeInstitute(instituteId: string, userId: string, global = false, minimum: InstituteRole = "INSTITUTE_MODERATOR") {
  if (global) return true;
  const member = await getInstituteMembership(instituteId, userId);
  return Boolean(member && member.role !== "INSTITUTE_MEMBER" && (minimum === "INSTITUTE_MODERATOR" || member.role === "INSTITUTE_ADMIN"));
}
