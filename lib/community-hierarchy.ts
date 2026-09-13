export type HierarchyCommunity = {
  id: string;
  name: string;
  creatorId: string;
  parentId: string | null;
  memberCount: number;
  createdAt: number;
};

export type HierarchyMember = {
  id: string;
  communityId: string;
  userId: string;
  role: "MEMBER" | "COMMUNITY_MODERATOR" | "COMMUNITY_ADMIN";
  createdAt: number;
};

export type HierarchyDatabase = {
  communities: Record<string, HierarchyCommunity>;
  members: Record<string, HierarchyMember>;
  memberIndex: Record<string, string>;
};

function membershipKey(communityId: string, userId: string) {
  return `${communityId}:${userId}`;
}

export function isCommunityType(value: unknown): value is "COLLEGE" | "INDIVIDUAL" | "COMPANY" {
  return value === "COLLEGE" || value === "INDIVIDUAL" || value === "COMPANY";
}

export function normalizeCommunityType(value: unknown) {
  return isCommunityType(value) ? value : "INDIVIDUAL" as const;
}

export function directCommunityMembership(database: HierarchyDatabase, communityId: string, userId: string) {
  const membershipId = database.memberIndex[membershipKey(communityId, userId)];
  return membershipId ? database.members[membershipId] : undefined;
}

export function isDirectCommunityAdmin(database: HierarchyDatabase, community: HierarchyCommunity, userId: string) {
  return community.creatorId === userId || directCommunityMembership(database, community.id, userId)?.role === "COMMUNITY_ADMIN";
}

export function parentCommunityAdminMemberships(database: HierarchyDatabase, community: HierarchyCommunity) {
  if (!community.parentId) return [] as HierarchyMember[];
  const parent = database.communities[community.parentId];
  if (!parent) return [] as HierarchyMember[];
  const admins = Object.values(database.members).filter((member) => member.communityId === parent.id && member.role === "COMMUNITY_ADMIN");
  if (parent.creatorId !== "system" && !admins.some((member) => member.userId === parent.creatorId)) {
    admins.push({ id: `creator:${parent.id}`, communityId: parent.id, userId: parent.creatorId, role: "COMMUNITY_ADMIN", createdAt: parent.createdAt });
  }
  return admins;
}

export function resolveCommunityHierarchyAccess(database: HierarchyDatabase, community: HierarchyCommunity, userId: string) {
  const direct = directCommunityMembership(database, community.id, userId);
  if (isDirectCommunityAdmin(database, community, userId)) return { joined: true, role: "COMMUNITY_ADMIN" as const, membershipSource: "DIRECT" as const };
  if (parentCommunityAdminMemberships(database, community).some((member) => member.userId === userId)) {
    return { joined: true, role: "COMMUNITY_ADMIN" as const, membershipSource: "PARENT" as const };
  }
  return direct
    ? { joined: true, role: direct.role, membershipSource: "DIRECT" as const }
    : { joined: false, role: undefined, membershipSource: null };
}

export function effectiveCommunityMemberCount(database: HierarchyDatabase, community: HierarchyCommunity) {
  const inheritedOnly = parentCommunityAdminMemberships(database, community)
    .filter((member) => !directCommunityMembership(database, community.id, member.userId));
  return community.memberCount + new Set(inheritedOnly.map((member) => member.userId)).size;
}

export type EffectiveCommunityMember = HierarchyMember & {
  inherited: boolean;
  readOnly: boolean;
  inheritedFromCommunityId: string | null;
  inheritedFromCommunityName: string | null;
};

export function effectiveCommunityMemberRecords(database: HierarchyDatabase, community: HierarchyCommunity) {
  const parent = community.parentId ? database.communities[community.parentId] : undefined;
  const inherited = new Map(parentCommunityAdminMemberships(database, community).map((member) => [member.userId, member]));
  const records: EffectiveCommunityMember[] = Object.values(database.members)
    .filter((member) => member.communityId === community.id)
    .map((member) => {
      const inheritsAdmin = inherited.has(member.userId) && member.role !== "COMMUNITY_ADMIN" && community.creatorId !== member.userId;
      inherited.delete(member.userId);
      return {
        ...member,
        role: inheritsAdmin ? "COMMUNITY_ADMIN" as const : member.role,
        inherited: inheritsAdmin,
        readOnly: inheritsAdmin || member.role === "COMMUNITY_ADMIN",
        inheritedFromCommunityId: inheritsAdmin ? parent?.id || null : null,
        inheritedFromCommunityName: inheritsAdmin ? parent?.name || null : null,
      };
    });
  for (const member of inherited.values()) {
    records.push({
      id: `inherited:${community.id}:${member.userId}`,
      communityId: community.id,
      userId: member.userId,
      role: "COMMUNITY_ADMIN",
      createdAt: member.createdAt,
      inherited: true,
      readOnly: true,
      inheritedFromCommunityId: parent?.id || null,
      inheritedFromCommunityName: parent?.name || null,
    });
  }
  return records.sort((a, b) => a.createdAt - b.createdAt || a.userId.localeCompare(b.userId));
}

export function validateCommunityParent(database: HierarchyDatabase, parentId: string | null, creatorId: string) {
  if (!parentId) return null;
  const parent = database.communities[parentId];
  if (!parent) return { error: "Parent community not found.", status: 404 } as const;
  if (parent.parentId) return { error: "Sub-communities cannot contain their own sub-communities.", status: 400 } as const;
  if (resolveCommunityHierarchyAccess(database, parent, creatorId).role !== "COMMUNITY_ADMIN") {
    return { error: "Only a parent community admin can create its sub-communities.", status: 403 } as const;
  }
  return null;
}

export function communityHierarchyDeletionOrder(communities: Record<string, HierarchyCommunity>, communityId: string) {
  if (!communities[communityId]) return [];
  const order: string[] = [];
  const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    for (const child of Object.values(communities).filter((community) => community.parentId === id)) visit(child.id);
    order.push(id);
  }
  visit(communityId);
  return order;
}
