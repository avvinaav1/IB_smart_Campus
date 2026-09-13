import test from "node:test";
import assert from "node:assert/strict";
import {
  communityHierarchyDeletionOrder,
  effectiveCommunityMemberCount,
  effectiveCommunityMemberRecords,
  isCommunityType,
  normalizeCommunityType,
  parentCommunityAdminMemberships,
  resolveCommunityHierarchyAccess,
  validateCommunityParent,
  type HierarchyCommunity,
  type HierarchyDatabase,
  type HierarchyMember,
} from "../lib/community-hierarchy.ts";

function community(id: string, creatorId: string, parentId: string | null = null, memberCount = 1): HierarchyCommunity {
  return { id, name: `c/${id}`, creatorId, parentId, memberCount, createdAt: 1 };
}

function member(id: string, communityId: string, userId: string, role: HierarchyMember["role"]): HierarchyMember {
  return { id, communityId, userId, role, createdAt: 1 };
}

function database(communities: HierarchyCommunity[], members: HierarchyMember[] = []): HierarchyDatabase {
  return {
    communities: Object.fromEntries(communities.map((item) => [item.id, item])),
    members: Object.fromEntries(members.map((item) => [item.id, item])),
    memberIndex: Object.fromEntries(members.map((item) => [`${item.communityId}:${item.userId}`, item.id])),
  };
}

test("community types are strict and legacy values migrate to INDIVIDUAL", () => {
  assert.equal(isCommunityType("COLLEGE"), true);
  assert.equal(isCommunityType("INDIVIDUAL"), true);
  assert.equal(isCommunityType("COMPANY"), true);
  assert.equal(isCommunityType("college"), false);
  assert.equal(normalizeCommunityType(undefined), "INDIVIDUAL");
  assert.equal(normalizeCommunityType("unknown"), "INDIVIDUAL");
});

test("only a parent admin can create one level of sub-community", () => {
  const parent = community("parent", "owner");
  const child = community("child", "owner", "parent");
  const snapshot = database([parent, child], [member("parent-admin", "parent", "owner", "COMMUNITY_ADMIN")]);
  assert.equal(validateCommunityParent(snapshot, null, "anyone"), null);
  assert.equal(validateCommunityParent(snapshot, "parent", "owner"), null);
  assert.deepEqual(validateCommunityParent(snapshot, "missing", "owner"), { error: "Parent community not found.", status: 404 });
  assert.deepEqual(validateCommunityParent(snapshot, "parent", "outsider"), { error: "Only a parent community admin can create its sub-communities.", status: 403 });
  assert.deepEqual(validateCommunityParent(snapshot, "child", "owner"), { error: "Sub-communities cannot contain their own sub-communities.", status: 400 });
});

test("parent admins inherit joined admin access and count once", () => {
  const parent = community("parent", "owner", null, 2);
  const child = community("child", "child-owner", "parent", 1);
  const snapshot = database([parent, child], [
    member("owner-parent", "parent", "owner", "COMMUNITY_ADMIN"),
    member("second-parent", "parent", "second-admin", "COMMUNITY_ADMIN"),
    member("owner-child", "child", "owner", "MEMBER"),
    member("child-owner", "child", "child-owner", "COMMUNITY_ADMIN"),
  ]);
  assert.deepEqual(resolveCommunityHierarchyAccess(snapshot, child, "owner"), { joined: true, role: "COMMUNITY_ADMIN", membershipSource: "PARENT" });
  assert.deepEqual(resolveCommunityHierarchyAccess(snapshot, child, "second-admin"), { joined: true, role: "COMMUNITY_ADMIN", membershipSource: "PARENT" });
  assert.deepEqual(resolveCommunityHierarchyAccess(snapshot, child, "outsider"), { joined: false, role: undefined, membershipSource: null });
  assert.equal(effectiveCommunityMemberCount(snapshot, child), 2);
  assert.deepEqual(parentCommunityAdminMemberships(snapshot, child).map((item) => item.userId).sort(), ["owner", "second-admin"]);
  const roster = effectiveCommunityMemberRecords(snapshot, child);
  assert.equal(roster.length, 3);
  assert.deepEqual(roster.find((item) => item.userId === "owner"), {
    ...snapshot.members["owner-child"],
    role: "COMMUNITY_ADMIN",
    inherited: true,
    readOnly: true,
    inheritedFromCommunityId: "parent",
    inheritedFromCommunityName: "c/parent",
  });
  assert.equal(roster.find((item) => item.userId === "second-admin")?.id, "inherited:child:second-admin");
  assert.equal(roster.find((item) => item.userId === "second-admin")?.readOnly, true);
});

test("community deletion order is descendant-first and child deletion leaves its parent", () => {
  const snapshot = database([
    community("parent", "owner"),
    community("child-a", "owner", "parent"),
    community("child-b", "owner", "parent"),
  ]);
  const parentOrder = communityHierarchyDeletionOrder(snapshot.communities, "parent");
  assert.equal(parentOrder.at(-1), "parent");
  assert.deepEqual(new Set(parentOrder.slice(0, -1)), new Set(["child-a", "child-b"]));
  assert.deepEqual(communityHierarchyDeletionOrder(snapshot.communities, "child-a"), ["child-a"]);
  assert.deepEqual(communityHierarchyDeletionOrder(snapshot.communities, "missing"), []);
});
