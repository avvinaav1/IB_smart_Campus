export const STREAK_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type StreakAction = "POST_LIKE" | "POST_COMMENT" | "POST_CREATE" | "CHAT_MESSAGE" | "COMMUNITY_JOIN";

export type StoredStreakState = {
  streakCount: number;
  streakLastActivityAt: number | null;
  streakLastAwardAt: number | null;
  streakActionKeys: Record<string, true>;
};

export function visibleStreakCount(state: Pick<StoredStreakState, "streakCount" | "streakLastActivityAt">, now = Date.now()) {
  if (!state.streakLastActivityAt || now - state.streakLastActivityAt >= STREAK_WINDOW_MS) return 0;
  return Math.max(0, Math.floor(state.streakCount));
}

export function applyStreakActivity(state: StoredStreakState, actionKey: string, now = Date.now()) {
  const currentCount = visibleStreakCount(state, now);
  if (state.streakActionKeys[actionKey]) return { awarded: false, streakCount: currentCount } as const;

  state.streakActionKeys[actionKey] = true;
  const expired = currentCount === 0;
  const awardDue = expired || !state.streakLastAwardAt || now - state.streakLastAwardAt >= STREAK_WINDOW_MS;
  if (expired) state.streakCount = 0;
  if (awardDue) {
    state.streakCount += 1;
    state.streakLastAwardAt = now;
  }
  state.streakLastActivityAt = now;
  return { awarded: awardDue, streakCount: state.streakCount } as const;
}
