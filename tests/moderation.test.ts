import test from "node:test";
import assert from "node:assert/strict";
import {
  canDelegateAppRoles,
  eventStatusForCommunity,
  isGlobalModerator,
  isProtectedSuperAdminUsername,
  isScopedCommunityModerator,
  normalizeAppRole,
  normalizeCommunityRole,
  normalizeEventStatus,
} from "../lib/moderation-policy.ts";

test("auth v6 roles migrate to the v7 protected-account invariant", () => {
  assert.equal(normalizeAppRole("KavinAV75", "USER"), "SUPER_ADMIN");
  assert.equal(normalizeAppRole(" kavinav75 ", undefined), "SUPER_ADMIN");
  assert.equal(normalizeAppRole("another-user", "SUPER_ADMIN"), "USER");
  assert.equal(normalizeAppRole("moderator", "APP_MODERATOR"), "APP_MODERATOR");
  assert.equal(isProtectedSuperAdminUsername("KAVINAV75"), true);
});

test("community v2 roles migrate to v3 roles", () => {
  assert.equal(normalizeCommunityRole("ADMIN"), "COMMUNITY_ADMIN");
  assert.equal(normalizeCommunityRole("COMMUNITY_MODERATOR"), "COMMUNITY_MODERATOR");
  assert.equal(normalizeCommunityRole("MEMBER"), "MEMBER");
  assert.equal(normalizeCommunityRole("unknown"), "MEMBER");
});

test("event v4 records migrate to approved and new scope determines initial status", () => {
  assert.equal(normalizeEventStatus(undefined), "APPROVED");
  assert.equal(normalizeEventStatus("legacy-approved"), "APPROVED");
  assert.equal(normalizeEventStatus("PENDING"), "PENDING");
  assert.equal(normalizeEventStatus("REJECTED"), "REJECTED");
  assert.equal(eventStatusForCommunity("community-1"), "PENDING");
  assert.equal(eventStatusForCommunity(null), "APPROVED");
});

test("the global and scoped permission matrix is explicit", () => {
  assert.equal(isGlobalModerator("USER"), false);
  assert.equal(isGlobalModerator("APP_MODERATOR"), true);
  assert.equal(isGlobalModerator("SUPER_ADMIN"), true);
  assert.equal(canDelegateAppRoles("APP_MODERATOR"), false);
  assert.equal(canDelegateAppRoles("SUPER_ADMIN"), true);
  assert.equal(isScopedCommunityModerator("USER", "MEMBER"), false);
  assert.equal(isScopedCommunityModerator("USER", "COMMUNITY_MODERATOR"), true);
  assert.equal(isScopedCommunityModerator("USER", "COMMUNITY_ADMIN"), true);
  assert.equal(isScopedCommunityModerator("APP_MODERATOR", undefined), true);
});
