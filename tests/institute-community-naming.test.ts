import test from "node:test";
import assert from "node:assert/strict";
import { instituteCommunityIdentity } from "../lib/institute-community-naming.ts";

test("Institute communities receive one literal ic-backslash prefix", () => {
  assert.deepEqual(instituteCommunityIdentity("Gaming"), { name: "ic\\Gaming", slug: "ic\\gaming" });
  assert.deepEqual(instituteCommunityIdentity("c/gaming"), { name: "ic\\gaming", slug: "ic\\gaming" });
  assert.deepEqual(instituteCommunityIdentity("ic\\Gaming"), { name: "ic\\Gaming", slug: "ic\\gaming" });
  assert.deepEqual(instituteCommunityIdentity("ic/Gaming Club"), { name: "ic\\Gaming Club", slug: "ic\\gaming-club" });
});
