import "server-only";
import type { SessionUser } from "./types";
export function developmentPreviewUser(): SessionUser | undefined {
  if (process.env.NODE_ENV !== "development" || process.env.DEV_SKIP_LOGIN !== "true") return undefined;
  return { id: "local-preview", email: "preview@example.test", username: "Preview Student", about: "Exploring Smart Campus", campus: "", avatarUrl: "", isPrivate: false, hasPassword: false, points: 0, streakCount: 0, referralCode: "SC-PREVIEW", profileSetupComplete: true, createdAt: 0, appRole: "USER" };
}
