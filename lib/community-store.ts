import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { communities as initialCommunities } from "@/lib/data";
import type { Community } from "@/lib/types";

export type CommunityRole = "ADMIN" | "MEMBER";
export type CommunityPrivacy = "public" | "restricted" | "private";

type StoredCommunity = {
  id: string;
  name: string;
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
  version: 2;
  communities: Record<string, StoredCommunity>;
  members: Record<string, CommunityMember>;
  memberIndex: Record<string, string>;
  nameIndex: Record<string, string>;
};

export type NewCommunityInput = {
  name: string;
  description: string;
  color: string;
  emoji: string;
  privacy: CommunityPrivacy;
};

const databasePath = process.env.COMMUNITIES_DATA_FILE || path.join(process.cwd(), ".data", "communities.json");
let databasePromise: Promise<CommunityDatabase> | undefined;
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
    version: 2,
    communities,
    members: {},
    memberIndex: {},
    nameIndex: Object.fromEntries(Object.values(communities).map((community) => [community.name.toLowerCase(), community.id])),
  };
}

async function loadDatabase() {
  if (!databasePromise) {
    databasePromise = readFile(/* turbopackIgnore: true */ databasePath, "utf8")
      .then((raw) => {
        const parsed = JSON.parse(raw) as Partial<CommunityDatabase>;
        const communities = Object.fromEntries(Object.entries(parsed.communities || {}).map(([id, community]) => [id, {
          ...community,
          iconUrl: typeof community.iconUrl === "string" ? community.iconUrl : "",
          bannerUrl: typeof community.bannerUrl === "string" ? community.bannerUrl : "",
        }])) as Record<string, StoredCommunity>;
        const database: CommunityDatabase = {
          version: 2,
          communities,
          members: parsed.members || {},
          memberIndex: parsed.memberIndex || {},
          nameIndex: parsed.nameIndex || {},
        };
        for (const member of Object.values(database.members)) database.memberIndex[membershipKey(member.communityId, member.userId)] = member.id;
        for (const community of Object.values(database.communities)) database.nameIndex[community.name.toLowerCase()] = community.id;
        return database;
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return seededDatabase();
        throw error;
      });
  }
  return databasePromise;
}

async function saveDatabase(database: CommunityDatabase) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, JSON.stringify(database, null, 2), "utf8");
}

function mutate<T>(action: (database: CommunityDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    const database = await loadDatabase();
    const result = await action(database);
    await saveDatabase(database);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function publicCommunity(database: CommunityDatabase, community: StoredCommunity, viewerId: string): Community {
  const membershipId = database.memberIndex[membershipKey(community.id, viewerId)];
  const membership = membershipId ? database.members[membershipId] : undefined;
  return {
    ...community,
    members: formatMemberCount(community.memberCount),
    joined: Boolean(membership),
    role: membership?.role,
  };
}

export function validateCommunityInput(input: NewCommunityInput) {
  const name = normalizeName(input.name);
  if (!/^c\/[a-z0-9][a-z0-9-]{2,39}$/.test(name)) return "Community names need 3–40 letters, numbers, or hyphens.";
  if (input.description.trim().length < 12 || input.description.trim().length > 180) return "Descriptions must be 12–180 characters.";
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) return "Choose a valid community color.";
  if (!input.emoji.trim() || input.emoji.trim().length > 8) return "Choose a short community icon.";
  if (!["public", "restricted", "private"].includes(input.privacy)) return "Choose a valid community visibility.";
  return "";
}

export async function listCommunities(viewerId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.communities)
    .sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name))
    .map((community) => publicCommunity(database, community, viewerId));
}

export async function createCommunity(creatorId: string, input: NewCommunityInput) {
  return mutate((database) => {
    const name = normalizeName(input.name);
    if (database.nameIndex[name.toLowerCase()]) return { error: "That community name is already taken." } as const;
    const now = Date.now();
    const id = randomUUID();
    const community: StoredCommunity = { id, name, description: input.description.trim(), creatorId, color: input.color.toUpperCase(), emoji: input.emoji.trim(), iconUrl: "", bannerUrl: "", privacy: input.privacy, memberCount: 1, createdAt: now, updatedAt: now };
    const membership: CommunityMember = { id: randomUUID(), communityId: id, userId: creatorId, role: "ADMIN", createdAt: now };
    database.communities[id] = community;
    database.nameIndex[name.toLowerCase()] = id;
    database.members[membership.id] = membership;
    database.memberIndex[membershipKey(id, creatorId)] = membership.id;
    return { community: publicCommunity(database, community, creatorId) } as const;
  });
}

export async function setCommunityMembership(communityId: string, userId: string, joined: boolean) {
  return mutate((database) => {
    const community = database.communities[communityId];
    if (!community) return { error: "Community not found.", status: 404 } as const;
    const key = membershipKey(communityId, userId);
    const existingId = database.memberIndex[key];
    const existing = existingId ? database.members[existingId] : undefined;
    if (joined && !existing) {
      const membership: CommunityMember = { id: randomUUID(), communityId, userId, role: "MEMBER", createdAt: Date.now() };
      database.members[membership.id] = membership;
      database.memberIndex[key] = membership.id;
      community.memberCount += 1;
      community.updatedAt = Date.now();
    } else if (!joined && existing?.role === "ADMIN") {
      return { error: "Community admins cannot leave their own community.", status: 400 } as const;
    } else if (!joined && existing) {
      delete database.members[existing.id];
      delete database.memberIndex[key];
      community.memberCount = Math.max(0, community.memberCount - 1);
      community.updatedAt = Date.now();
    }
    return { community: publicCommunity(database, community, userId) } as const;
  });
}

function canManage(database: CommunityDatabase, community: StoredCommunity, userId: string) {
  if (community.creatorId === userId) return true;
  const membershipId = database.memberIndex[membershipKey(community.id, userId)];
  return Boolean(membershipId && database.members[membershipId]?.role === "ADMIN");
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
  const membership = database.memberIndex[membershipKey(communityId, userId)];
  if (community.privacy !== "public" && !membership) return { error: "Join this community before posting." } as const;
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
      const membership: CommunityMember = { id: randomUUID(), communityId: id, userId: creatorId, role: "ADMIN", createdAt: now };
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
