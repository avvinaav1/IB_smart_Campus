import test from "node:test";
import assert from "node:assert/strict";
import { canApproveInstituteCommunityEvent, canApproveInstituteEvent, canCreateInstituteContent, canManageInstitutes, isGlobalModerator, isInstituteModerator } from "../lib/moderation-policy.ts";

test("only global roles can create institutes and assign institute roles", () => {
  assert.equal(canManageInstitutes("USER"), false);
  assert.equal(canManageInstitutes("APP_MODERATOR"), true);
  assert.equal(canManageInstitutes("SUPER_ADMIN"), true);
});

test("institute scope recognizes both institute roles while global roles remain global", () => {
  assert.equal(isInstituteModerator("INSTITUTE_ADMIN"), true);
  assert.equal(isInstituteModerator("INSTITUTE_MODERATOR"), true);
  assert.equal(isInstituteModerator(undefined), false);
  assert.equal(isGlobalModerator("APP_MODERATOR"), true);
  assert.equal(isGlobalModerator("USER"), false);
});

test("institute content requires institute membership unless the actor is a global moderator", () => {
  assert.equal(canCreateInstituteContent("USER", undefined), false);
  assert.equal(canCreateInstituteContent("USER", "INSTITUTE_MEMBER"), true);
  assert.equal(canCreateInstituteContent("USER", "INSTITUTE_MODERATOR"), true);
  assert.equal(canCreateInstituteContent("APP_MODERATOR", undefined), true);
});

test("event approval includes institute moderators and relevant community admins", () => {
  assert.equal(canApproveInstituteEvent("USER", "INSTITUTE_ADMIN"), true);
  assert.equal(canApproveInstituteEvent("USER", "INSTITUTE_MODERATOR"), true);
  assert.equal(canApproveInstituteEvent("APP_MODERATOR", undefined), true);
  assert.equal(canApproveInstituteCommunityEvent("USER", undefined, "COMMUNITY_ADMIN"), true);
  assert.equal(canApproveInstituteCommunityEvent("USER", "INSTITUTE_ADMIN", "MEMBER"), true);
  assert.equal(canApproveInstituteCommunityEvent("USER", "INSTITUTE_MODERATOR", "COMMUNITY_ADMIN"), true);
  assert.equal(canApproveInstituteCommunityEvent("USER", "INSTITUTE_MODERATOR", "COMMUNITY_MODERATOR"), true);
});
