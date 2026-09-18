import { randomUUID } from "node:crypto";
import { communities as initialCommunities } from "@/lib/data";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import { communityHierarchyDeletionOrder, effectiveCommunityMemberCount, effectiveCommunityMemberRecords, isCommunityType, normalizeCommunityType, parentCommunityAdminMemberships, resolveCommunityHierarchyAccess, validateCommunityParent } from "@/lib/community-hierarchy";
import type { Community, CommunityRole, CommunityType, InstituteRole } from "@/lib/types";
import { normalizeCommunityRole } from "@/lib/moderation-policy";
import { getInstitute, getInstituteMembership } from "@/lib/institute-store";
import type { CommunityStatus } from "@/lib/types";
import { instituteCommunityIdentity } from "@/lib/institute-community-naming";

export type { CommunityRole } from "@/lib/types";
export type CommunityPrivacy = "public" | "restricted" | "private";

type StoredCommunity = {
  id: string;
  name: string;
  slug: string;
  instituteId: string | null;
  status: CommunityStatus;
  type: CommunityType;
  parentId: string | null;
  description: string;
  creatorId: string;
  color: string;
  emoji: string;
  iconUrl: string;
  bannerUrl: string;
  privacy: CommunityPrivacy;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
};

type CommunityMember = {
  id: string;
  communityId: string;
  userId: string;
  role: CommunityRole;
  createdAt: number;
};

type CommunityDatabase = {
  version: 4;
  communities: Record<string, StoredCommunity>;
  members: Record<string, CommunityMember>;
  memberIndex: Record<string, string>;
  nameIndex: Record<string, string>;
};

export type NewCommunityInput = {
  name: string;
  type: CommunityType;
  parentId: string | null;
  description: string;
  color: string;
  emoji: string;
  privacy: CommunityPrivacy;
  instituteId?: string | null;
};

const STORE_DOC = process.env.COMMUNITIES_STORE_DOC || "communities";
let writeQueue: Promise<unknown> = Promise.resolve();

function normalizeName(value: string) {
  const slug = value.toLowerCase().trim().replace(/^c\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return slug ? `c/${slug}` : "";
}

function membershipKey(communityId: string, userId: string) {
  return `${communityId}:${userId}`;
}

function parseMemberCount(value: string) {
  const normalized = value.toLowerCase().trim();
  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * (normalized.endsWith("k") ? 1_000 : 1)));
}

function formatMemberCount(value: number) {
  if (value < 1_000) return String(value);
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 1).replace(/\.0$/, "")}k`;
}

function seededDatabase(): CommunityDatabase {
  const communities = Object.fromEntries(initialCommunities.map((community) => [community.id, {
    id: community.id,
    name: community.name,
    slug: community.id,
    instituteId: null,
    status: "APPROVED" as const,
    type: community.type,
    parentId: community.parentId,
    description: community.description,
    creatorId: community.creatorId,
    color: community.color,
    emoji: community.emoji,
    iconUrl: community.iconUrl,
    bannerUrl: community.bannerUrl,
    privacy: community.privacy || "public",
    memberCount: parseMemberCount(community.members),
    createdAt: community.createdAt,
    updatedAt: community.updatedAt,
  }]));
  return {
    version: 4,
    communities,
    members: {},
    memberIndex: {},
    nameIndex: Object.fromEntries(Object.values(communities).map((community) => [community.name.toLowerCase(), community.id])),
  };
}

function hydrate(parsed: Partial<CommunityDatabase> | null): CommunityDatabase {
  if (!parsed || !parsed.communities) return seededDatabase();
  const communities = Object.fromEntries(Object.entries(parsed.communities || {}).map(([id, community]) => [id, {
    ...community,
    type: normalizeCommunityType(community.type),
    parentId: typeof community.parentId === "string" && community.parentId ? community.parentId : null,
    iconUrl: typeof community.iconUrl === "string" ? community.iconUrl : "",
    bannerUrl: typeof community.bannerUrl === "string" ? community.bannerUrl : "",
    slug: typeof community.slug === "string" && community.slug ? community.slug : community.name,
    instituteId: typeof community.instituteId === "string" && community.instituteId ? community.instituteId : null,
    status: community.status === "PENDING" || community.status === "REJECTED" ? community.status : "APPROVED",
  }])) as Record<string, StoredCommunity>;
  const database: CommunityDatabase = {
    version: 4,
    communities,
    members: parsed.members || {},
    memberIndex: parsed.memberIndex || {},
    nameIndex: parsed.nameIndex || {},
  };
  for (const community of Object.values(database.communities)) {
    if (community.instituteId) {
      const previousName = community.name;
      const identity = instituteCommunityIdentity(community.name);
      community.name = identity.name;
      community.slug = identity.slug;
      if (previousName !== community.name) delete database.nameIndex[previousName.toLowerCase()];
    }
    if (!community.parentId) continue;
    const parent = database.communities[community.parentId];
    if (!parent || parent.id === community.id || parent.parentId) community.parentId = null;
  }
  for (const member of Object.values(database.members)) {
    member.role = normalizeCommunityRole(member.role);
    database.memberIndex[membershipKey(member.communityId, member.userId)] = member.id;
  }
  for (const community of Object.values(database.communities)) database.nameIndex[community.name.toLowerCase()] = community.id;
  for (const community of Object.values(database.communities)) {
    if (community.creatorId === "system") continue;
    const key = membershipKey(community.id, community.creatorId);
    const existingId = database.memberIndex[key];
    if (existingId && database.members[existingId]) database.members[existingId].role = "COMMUNITY_ADMIN";
    else {
      const member: CommunityMember = { id: randomUUID(), communityId: community.id, userId: community.creatorId, role: "COMMUNITY_ADMIN", createdAt: community.createdAt };
      database.members[member.id] = member;
      database.memberIndex[key] = member.id;
      community.memberCount = Math.max(1, community.memberCount);
    }
  }
  return database;
}

async function loadDatabase(options?: { fresh?: boolean }) {
  return hydrate(await readDocument<Partial<CommunityDatabase>>(STORE_DOC, options));
}

function mutate<T>(action: (database: CommunityDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<CommunityDatabase>, CommunityDatabase>(STORE_DOC, async (current) => {
      const database = hydrate(current);
      result = await action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function publicCommunity(database: CommunityDatabase, community: StoredCommunity, viewerId: string): Community {
  const access = resolveCommunityHierarchyAccess(database, community, viewerId);
  return {
    ...community,
    members: formatMemberCount(effectiveCommunityMemberCount(database, community)),
    joined: access.joined,
    role: access.role,
    membershipSource: access.membershipSource,
  };
}

async function withInstituteRoles(items: Community[], viewerId: string) {
  const instituteIds = [...new Set(items.map((item) => item.instituteId).filter((id): id is string => Boolean(id)))];
  const roles = new Map<string, InstituteRole>();
  await Promise.all(instituteIds.map(async (instituteId) => {
    const membership = await getInstituteMembership(instituteId, viewerId);
    if (membership) roles.set(instituteId, membership.role);
  }));
  return items.map((item) => item.instituteId ? { ...item, instituteRole: roles.get(item.instituteId) } : item);
}

export function validateCommunityInput(input: NewCommunityInput) {
  const name = normalizeName(input.name);
  if (!/^c\/[a-z0-9][a-z0-9-]{2,39}$/.test(name)) return "Community names need 3–40 letters, numbers, or hyphens.";
  if (input.description.trim().length < 12 || input.description.trim().length > 180) return "Descriptions must be 12–180 characters.";
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) return "Choose a valid community color.";
  if (!input.emoji.trim() || input.emoji.trim().length > 8) return "Choose a short community icon.";
  if (!["public", "restricted", "private"].includes(input.privacy)) return "Choose a valid community visibility.";
  if (!isCommunityType(input.type)) return "Choose a valid community type.";
  if (input.parentId !== null && !input.parentId.trim()) return "Choose a valid parent community.";
  return "";
}

export async function listCommunities(viewerId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const items = Object.values(database.communities)
    .filter(community => community.status === "APPROVED" || community.creatorId === viewerId || resolveCommunityHierarchyAccess(database, community, viewerId).role === "COMMUNITY_ADMIN")
    .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name))
    .map((community) => publicCommunity(database, community, viewerId));
  return withInstituteRoles(items, viewerId);
}

export async function createCommunity(creatorId: string, input: NewCommunityInput) {
  if (input.instituteId && !(await getInstitute(input.instituteId))) return { error: "Institute not found.", status: 404 } as const;
  return mutate((database) => {
    const parent = input.parentId ? database.communities[input.parentId] : null;
    if (parent?.instituteId && input.instituteId && parent.instituteId !== input.instituteId) {
      return { error: "A sub-community must belong to the same institute as its parent.", status: 409 } as const;
    }
    const instituteId = parent?.instituteId || input.instituteId || null;
    const identity = instituteId ? instituteCommunityIdentity(input.name) : null;
    const name = identity?.name || normalizeName(input.name);
    if (database.nameIndex[name.toLowerCase()]) return { error: "That community name is already taken.", status: 409 } as const;
    if (identity && Object.values(database.communities).some(community => community.slug.toLowerCase() === identity.slug.toLowerCase())) return { error: "That community URL slug is already taken.", status: 409 } as const;
    const parentError = validateCommunityParent(database, input.parentId, creatorId);
    if (parentError) return parentError;
    const now = Date.now();
    const id = randomUUID();
    const community: StoredCommunity = { id, name, slug: identity?.slug || name, instituteId, status: instituteId ? "PENDING" : "APPROVED", type: input.type, parentId: input.parentId, description: input.description.trim(), creatorId, color: input.color.toUpperCase(), emoji: input.emoji.trim(), iconUrl: "", bannerUrl: "", privacy: input.privacy, memberCount: 1, createdAt: now, updatedAt: now };
    const membership: CommunityMember = { id: randomUUID(), communityId: id, userId: creatorId, role: "COMMUNITY_ADMIN", createdAt: now };
    database.communities[id] = community;
    database.nameIndex[name.toLowerCase()] = id;
    database.members[membership.id] = membership;
    database.memberIndex[membershipKey(id, creatorId)] = membership.id;
    return { community: publicCommunity(database, community, creatorId) } as const;
  });
}

export async function importCommunityIntoInstitute(communityId: string, instituteId: string, viewerId: string) {
  if (!(await getInstitute(instituteId))) return { error: "Institute not found.", status: 404 } as const;
  return mutate(database => {
    const community = database.communities[communityId];
    if (!community) return { error: "Community not found.", status: 404 } as const;
    if (community.instituteId && community.instituteId !== instituteId) return { error: "Community already belongs to another institute.", status: 409 } as const;
    const oldName = community.name;
    const identity = instituteCommunityIdentity(oldName);
    const name = identity.name;
    const conflict = database.nameIndex[name.toLowerCase()];
    if (conflict && conflict !== communityId) return { error: "That institute community name is already taken.", status: 409 } as const;
    if (Object.values(database.communities).some(item => item.id !== communityId && item.slug.toLowerCase() === identity.slug.toLowerCase())) return { error: "That institute community URL slug is already taken.", status: 409 } as const;
    delete database.nameIndex[oldName.toLowerCase()];
    community.name = name;
    community.slug = identity.slug;
    community.instituteId = instituteId;
    community.status = "PENDING";
    community.updatedAt = Date.now();
    database.nameIndex[name.toLowerCase()] = communityId;
    return { community: publicCommunity(database, community, viewerId) } as const;
  });
}

export async function listPendingInstituteCommunities(instituteId: string, viewerId: string) {
  await writeQueue; const database = await loadDatabase({ fresh: true });
  const items = Object.values(database.communities).filter(c => c.instituteId === instituteId && c.status === "PENDING").map(c => publicCommunity(database, c, viewerId));
  return withInstituteRoles(items, viewerId);
}

export async function listInstituteCommunities(instituteId: string, viewerId: string, includeModeration = false) {
  await writeQueue;
  const database = await loadDatabase({ fresh: true });
  const items = Object.values(database.communities)
    .filter((community) => community.instituteId === instituteId && (includeModeration || community.status === "APPROVED" || community.creatorId === viewerId))
    .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name))
    .map((community) => publicCommunity(database, community, viewerId));
  return withInstituteRoles(items, viewerId);
}

export async function reviewInstituteCommunity(instituteId: string, communityId: string, reviewerId: string, status: Extract<CommunityStatus, "APPROVED" | "REJECTED">) {
  return mutate(database => {
    const community = database.communities[communityId];
    if (!community || community.instituteId !== instituteId) return { error: "Institute community not found.", status: 404 } as const;
    if (community.status !== "PENDING") return { error: "This community has already been reviewed.", status: 409 } as const;
    community.status = status; community.updatedAt = Date.now();
    return { community: publicCommunity(database, community, reviewerId) } as const;
  });
}

export async function setCommunityMembership(communityId: string, userId: string, joined: boolean) {
  return mutate((database) => {
    const community = database.communities[communityId];
    if (!community) return { error: "Community not found.", status: 404 } as const;
    const access = resolveCommunityHierarchyAccess(database, community, userId);
    if (joined && community.status !== "APPROVED" && access.role !== "COMMUNITY_ADMIN") {
      return { error: "This community is not open until its institute approves it.", status: 409 } as const;
    }
    if (!joined && access.role === "COMMUNITY_ADMIN") {
      return { error: access.membershipSource === "PARENT" ? "Parent community admins cannot leave inherited sub-community membership." : "Community admins cannot leave their own community.", status: 400 } as const;
    }
    const key = membershipKey(communityId, userId);
    const existingId = database.memberIndex[key];
    const existing = existingId ? database.members[existingId] : undefined;
    let changed = false;
    if (joined && !access.joined) {
      const membership: CommunityMember = { id: randomUUID(), communityId, userId, role: "MEMBER", createdAt: Date.now() };
      database.members[membership.id] = membership;
      database.memberIndex[key] = membership.id;
      community.memberCount += 1;
      community.updatedAt = Date.now();
      changed = true;
    } else if (!joined && existing) {
      delete database.members[existing.id];
      delete database.memberIndex[key];
      community.memberCount = Math.max(0, community.memberCount - 1);
      community.updatedAt = Date.now();
      changed = true;
    }
    return { community: publicCommunity(database, community, userId), changed } as const;
  });
}

function canManage(database: CommunityDatabase, community: StoredCommunity, userId: string) {
  return resolveCommunityHierarchyAccess(database, community, userId).role === "COMMUNITY_ADMIN";
}

export async function canManageCommunityBranding(communityId: string, userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const community = database.communities[communityId];
  if (!community) return { error: "Community not found.", status: 404 } as const;
  if (!canManage(database, community, userId)) return { error: "Only community admins can update community branding.", status: 403 } as const;
  return { allowed: true } as const;
}

export async function updateCommunityImage(communityId: string, userId: string, kind: "icon" | "banner", imageUrl: string) {
  return mutate((database) => {
    const community = database.communities[communityId];
    if (!community) return { error: "Community not found.", status: 404 } as const;
    if (!canManage(database, community, userId)) return { error: "Only community admins can update community branding.", status: 403 } as const;
    const previousUrl = kind === "icon" ? community.iconUrl : community.bannerUrl;
    if (kind === "icon") community.iconUrl = imageUrl;
    else community.bannerUrl = imageUrl;
    community.updatedAt = Date.now();
    return { community: publicCommunity(database, community, userId), previousUrl } as const;
  });
}

export async function resolveCommunityForPost(communityId: string, userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const community = database.communities[communityId];
  if (!community) return { error: "Choose a community that still exists." } as const;
  if (community.privacy !== "public" && !resolveCommunityHierarchyAccess(database, community, userId).joined) return { error: "Join this community before posting." } as const;
  return { community } as const;
}

export async function resolveCommunityIdByName(name: string) {
  await writeQueue;
  const database = await loadDatabase();
  return database.nameIndex[normalizeName(name).toLowerCase()] || "";
}

export async function ensureCommunityForLegacyPost(name: string, color: string, creatorId: string) {
  const normalizedName = normalizeName(name);
  return mutate((database) => {
    const existingId = database.nameIndex[normalizedName.toLowerCase()];
    if (existingId) return existingId;
    const now = Date.now();
    const id = randomUUID();
    const community: StoredCommunity = {
      id,
      name: normalizedName || `c/recovered-${id.slice(0, 8)}`,
      slug: normalizedName || `c/recovered-${id.slice(0, 8)}`,
      instituteId: null,
      status: "APPROVED",
      type: "INDIVIDUAL",
      parentId: null,
      description: "Recovered from an existing community post.",
      creatorId,
      color: /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "#6C3BFF",
      emoji: "👥",
      iconUrl: "",
      bannerUrl: "",
      privacy: "public",
      memberCount: creatorId === "system" ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    };
    database.communities[id] = community;
    database.nameIndex[community.name.toLowerCase()] = id;
    if (creatorId !== "system") {
      const membership: CommunityMember = { id: randomUUID(), communityId: id, userId: creatorId, role: "COMMUNITY_ADMIN", createdAt: now };
      database.members[membership.id] = membership;
      database.memberIndex[membershipKey(id, creatorId)] = membership.id;
    }
    return id;
  });
}

export async function visibleCommunityIds() {
  await writeQueue;
  const database = await loadDatabase();
  return new Set(Object.keys(database.communities));
}

export type CommunityMemberRecord = CommunityMember & {
  inherited: boolean;
  readOnly: boolean;
  inheritedFromCommunityId: string | null;
  inheritedFromCommunityName: string | null;
};
export type AdminCommunity = StoredCommunity & { members: number };

export async function getCommunityAccess(communityId: string, userId: string) {
  await writeQueue;
  const database = await loadDatabase({ fresh: true });
  const community = database.communities[communityId];
  if (!community) return null;
  const access = resolveCommunityHierarchyAccess(database, community, userId);
  return { communityId, creatorId: community.creatorId, ...access };
}

export async function listCommunityMemberRecords(communityId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const community = database.communities[communityId];
  if (!community) return null;
  return effectiveCommunityMemberRecords(database, community) as CommunityMemberRecord[];
}

export async function listEffectiveCommunityMemberIds(communityId: string) {
  const records = await listCommunityMemberRecords(communityId);
  return records ? [...new Set(records.map((member) => member.userId))] : [];
}

export async function setCommunityMemberRole(communityId: string, actorId: string, userId: string, role: Extract<CommunityRole, "MEMBER" | "COMMUNITY_MODERATOR">) {
  return mutate((database) => {
    const community = database.communities[communityId];
    if (!community) return { error: "Community not found.", status: 404 } as const;
    if (!canManage(database, community, actorId)) return { error: "Only the community admin can manage moderator roles.", status: 403 } as const;
    if (community.creatorId === userId) return { error: "The community creator must remain its admin.", status: 403 } as const;
    if (parentCommunityAdminMemberships(database, community).some((member) => member.userId === userId)) {
      return { error: "Inherited parent admins must be managed from the parent community.", status: 403 } as const;
    }
    const memberId = database.memberIndex[membershipKey(communityId, userId)];
    const member = memberId ? database.members[memberId] : undefined;
    if (!member) return { error: "That user is not a community member.", status: 404 } as const;
    member.role = role;
    community.updatedAt = Date.now();
    return { member } as const;
  });
}

export async function listAdminCommunities(query = "") {
  await writeQueue;
  const database = await loadDatabase();
  const normalized = query.trim().toLowerCase();
  return Object.values(database.communities)
    .filter((community) => !normalized || community.name.toLowerCase().includes(normalized) || community.description.toLowerCase().includes(normalized))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((community) => ({ ...community, members: effectiveCommunityMemberCount(database, community) }));
}

export async function communityDeletionOrder(communityId: string) {
  await writeQueue;
  const database = await loadDatabase({ fresh: true });
  if (!database.communities[communityId]) return [];
  return communityHierarchyDeletionOrder(database.communities, communityId);
}

export async function getCommunitySummary(communityId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const community = database.communities[communityId];
  return community ? { ...community } : null;
}

export async function communitiesCreatedBy(userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.communities).filter((community) => community.creatorId === userId).map((community) => community.id);
}

export async function removeUserCommunityMemberships(userId: string) {
  return mutate((database) => {
    for (const member of Object.values(database.members)) {
      if (member.userId !== userId) continue;
      delete database.members[member.id];
      delete database.memberIndex[membershipKey(member.communityId, userId)];
      const community = database.communities[member.communityId];
      if (community) community.memberCount = Math.max(0, community.memberCount - 1);
    }
    return { removed: true } as const;
  });
}

export async function deleteCommunityRecord(communityId: string) {
  return mutate((database) => {
    const community = database.communities[communityId];
    if (!community) return { deleted: false, imageUrls: [] as string[] } as const;
    for (const member of Object.values(database.members)) {
      if (member.communityId !== communityId) continue;
      delete database.members[member.id];
      delete database.memberIndex[membershipKey(communityId, member.userId)];
    }
    delete database.nameIndex[community.name.toLowerCase()];
    delete database.communities[communityId];
    return { deleted: true, imageUrls: [community.iconUrl, community.bannerUrl].filter(Boolean) } as const;
  });
}
