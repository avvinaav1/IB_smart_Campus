import test from "node:test";
import assert from "node:assert/strict";
import { applyStreakActivity, STREAK_WINDOW_MS, visibleStreakCount, type StoredStreakState } from "../lib/streak-policy.ts";

function streakState(): StoredStreakState {
  return { streakCount: 0, streakLastActivityAt: null, streakLastAwardAt: null, streakActionKeys: {} };
}

test("the first valid action starts a streak and only one award is possible per 24 hours", () => {
  const state = streakState();
  const started = applyStreakActivity(state, "post:first", 1_000);
  assert.deepEqual(started, { awarded: true, streakCount: 1 });

  const sameDay = applyStreakActivity(state, "comment:first", 1_000 + STREAK_WINDOW_MS - 1);
  assert.deepEqual(sameDay, { awarded: false, streakCount: 1 });

  const nextWindow = applyStreakActivity(state, "message:first", 1_000 + STREAK_WINDOW_MS);
  assert.deepEqual(nextWindow, { awarded: true, streakCount: 2 });
});

test("a full 24 hours without valid activity breaks the visible streak and the next action restarts at one", () => {
  const state = streakState();
  applyStreakActivity(state, "post:first", 1_000);
  assert.equal(visibleStreakCount(state, 1_000 + STREAK_WINDOW_MS - 1), 1);
  assert.equal(visibleStreakCount(state, 1_000 + STREAK_WINDOW_MS), 0);

  const restarted = applyStreakActivity(state, "post:second", 1_000 + STREAK_WINDOW_MS);
  assert.deepEqual(restarted, { awarded: true, streakCount: 1 });
});

test("replaying the same engagement cannot increment or keep the streak alive", () => {
  const state = streakState();
  applyStreakActivity(state, "like:post-1", 1_000);
  const duplicate = applyStreakActivity(state, "like:post-1", 1_000 + STREAK_WINDOW_MS + 10);
  assert.deepEqual(duplicate, { awarded: false, streakCount: 0 });
  assert.equal(state.streakLastActivityAt, 1_000);
});
