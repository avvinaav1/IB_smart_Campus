import { createHmac, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { isKnownIndianCampus } from "@/lib/campus-store";
import type { SessionUser } from "@/lib/types";

export type AuthIntent = "register" | "login";
type StoredUser = Omit<SessionUser, "isPrivate" | "campus" | "profileSetupComplete"> & { isPrivate?: boolean; campus?: string; profileSetupComplete?: boolean; passwordHash?: string };
type OtpRecord = { digest: string; intent: AuthIntent; referralCode?: string; expiresAt: number; attempts: number };
type EmailChangeRecord = { digest: string; userId: string; newEmail: string; expiresAt: number; attempts: number };
type SessionRecord = { userId: string; expiresAt: number };
type AuthState = {
  version: 6;
  users: Record<string, StoredUser>;
  emailIndex: Record<string, string>;
  referralIndex: Record<string, string>;
  otps: Record<string, OtpRecord>;
  emailChanges: Record<string, EmailChangeRecord>;
  sessions: Record<string, SessionRecord>;
  rateLimits: Record<string, number[]>;
};
type LegacyState = {
  version?: number;
  users?: Record<string, Partial<StoredUser> & { email: string; createdAt: number }>;
  emailIndex?: Record<string, string>;
  referralIndex?: Record<string, string>;
  otps?: Record<string, OtpRecord>;
  emailChanges?: Record<string, EmailChangeRecord>;
  sessions?: Record<string, { email?: string; userId?: string; expiresAt: number }>;
  rateLimits?: Record<string, number[]>;
};

const OTP_TTL_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const OTP_RATE_LIMIT = 6;
const PASSWORD_RATE_LIMIT = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const statePath = process.env.AUTH_DATA_FILE || (process.env.VERCEL ? path.join("/tmp", "auth.json") : path.join(process.cwd(), ".data", "auth.json"));
const scrypt = promisify(scryptCallback);
const emptyState = (): AuthState => ({ version: 6, users: {}, emailIndex: {}, referralIndex: {}, otps: {}, emailChanges: {}, sessions: {}, rateLimits: {} });

let statePromise: Promise<AuthState> | undefined;
let mutationQueue: Promise<unknown> = Promise.resolve();
let memoryState: AuthState | undefined;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required in production.");
  return "smart-campus-local-development-secret";
}

function digest(value: string) { return createHmac("sha256", secret()).update(value).digest("hex"); }
function otpKey(email: string) { return digest(`otp:${email}`); }
function emailChangeKey(userId: string, email: string) { return digest(`email-change:${userId}:${email}`); }
function sessionKey(token: string) { return digest(`session:${token}`); }

function defaultUsername(email: string, used: Set<string>) {
  const base = (email.split("@")[0] || "student").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "student";
  let candidate = base;
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 18)}${randomInt(1000, 9999)}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function normalizeReferralCode(value: string) { return value.trim().toUpperCase(); }

function createReferralCode(used: Set<string>) {
  let code = "";
  do code = `SC-${randomBytes(4).toString("hex").toUpperCase()}`;
  while (used.has(code));
  used.add(code);
  return code;
}

function normalizeState(value: LegacyState | null): AuthState {
  if ((value?.version === 2 || value?.version === 3 || value?.version === 4 || value?.version === 5 || value?.version === 6) && value.emailIndex && value.emailChanges) {
    const usedCodes = new Set<string>();
    const users: Record<string, StoredUser> = {};
    const referralIndex: Record<string, string> = {};
    for (const [id, stored] of Object.entries(value.users || {})) {
      const candidate = normalizeReferralCode(typeof stored.referralCode === "string" ? stored.referralCode : "");
      const referralCode = /^SC-[A-Z0-9]{6,12}$/.test(candidate) && !usedCodes.has(candidate) ? candidate : createReferralCode(usedCodes);
      usedCodes.add(referralCode);
      const points = typeof stored.points === "number" && Number.isFinite(stored.points) ? Math.max(0, Math.floor(stored.points)) : 0;
      users[id] = { ...stored, points, referralCode, campus: typeof stored.campus === "string" ? stored.campus.slice(0, 180) : "", isPrivate: Boolean(stored.isPrivate), profileSetupComplete: typeof stored.profileSetupComplete === "boolean" ? stored.profileSetupComplete : true } as StoredUser;
      referralIndex[referralCode] = id;
    }
    return {
      version: 6,
      users,
      emailIndex: value.emailIndex,
      referralIndex,
      otps: value.otps || {},
      emailChanges: value.emailChanges,
      sessions: value.sessions as Record<string, SessionRecord>,
      rateLimits: value.rateLimits || {},
    };
  }

  const state = emptyState();
  const emailToId = new Map<string, string>();
  const usedNames = new Set<string>();
  const usedCodes = new Set<string>();
  for (const legacyUser of Object.values(value?.users || {})) {
    const email = normalizeEmail(legacyUser.email);
    const id = randomUUID();
    const referralCode = createReferralCode(usedCodes);
    const user: StoredUser = { id, email, username: defaultUsername(email, usedNames), about: "", campus: "", avatarUrl: "", isPrivate: false, hasPassword: false, points: 0, referralCode, profileSetupComplete: true, createdAt: legacyUser.createdAt || Date.now() };
    state.users[id] = user;
    state.emailIndex[email] = id;
    state.referralIndex[referralCode] = id;
    emailToId.set(email, id);
  }
  state.otps = value?.otps || {};
  state.rateLimits = value?.rateLimits || {};
  for (const [key, legacySession] of Object.entries(value?.sessions || {})) {
    const userId = legacySession.userId || (legacySession.email ? emailToId.get(normalizeEmail(legacySession.email)) : undefined);
    if (userId) state.sessions[key] = { userId, expiresAt: legacySession.expiresAt };
  }
  return state;
}

async function loadState() {
  if (!statePromise) {
    statePromise = readFile(/* turbopackIgnore: true */ statePath, "utf8")
      .then(async (raw) => {
        const stored = JSON.parse(raw) as LegacyState;
        const normalized = normalizeState(stored);
        memoryState = normalized;
        const needsMigration = stored.version !== 6
          || !stored.referralIndex
          || Object.values(stored.users || {}).some((user) => typeof user.points !== "number" || typeof user.referralCode !== "string" || typeof user.campus !== "string" || typeof user.profileSetupComplete !== "boolean");
        if (needsMigration) await saveState(normalized);
        return normalized;
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error?.code === "ENOENT" || error?.code === "EACCES" || error?.code === "EPERM") {
          memoryState = memoryState || emptyState();
          return memoryState;
        }
        memoryState = memoryState || emptyState();
        return memoryState;
      });
  }
  return statePromise;
}

async function saveState(state: AuthState) {
  memoryState = state;
  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Vercel serverless filesystems can be read-only or ephemeral. Keep the active state in memory.
  }
}

function cleanup(state: AuthState, now: number) {
  for (const [key, otp] of Object.entries(state.otps)) if (otp.expiresAt <= now) delete state.otps[key];
  for (const [key, change] of Object.entries(state.emailChanges)) if (change.expiresAt <= now) delete state.emailChanges[key];
  for (const [key, session] of Object.entries(state.sessions)) if (session.expiresAt <= now) delete state.sessions[key];
  for (const [key, timestamps] of Object.entries(state.rateLimits)) {
    const active = timestamps.filter((time) => time > now - RATE_WINDOW_MS);
    if (active.length) state.rateLimits[key] = active;
    else delete state.rateLimits[key];
  }
}

function mutate<T>(action: (state: AuthState) => T | Promise<T>): Promise<T> {
  const operation = mutationQueue.then(async () => {
    const state = await loadState();
    cleanup(state, Date.now());
    const result = await action(state);
    await saveState(state);
    return result;
  });
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function consumeRateLimit(state: AuthState, scope: string, limit: number) {
  const now = Date.now();
  const key = digest(`rate:${scope}`);
  const timestamps = (state.rateLimits[key] || []).filter((time) => time > now - RATE_WINDOW_MS);
  if (timestamps.length >= limit) return Math.max(1, Math.ceil((timestamps[0] + RATE_WINDOW_MS - now) / 1000));
  timestamps.push(now);
  state.rateLimits[key] = timestamps;
  return 0;
}

function publicUser(user: StoredUser): SessionUser {
  return { id: user.id, email: user.email, username: user.username, about: user.about, campus: user.campus || "", avatarUrl: user.avatarUrl, isPrivate: Boolean(user.isPrivate), hasPassword: Boolean(user.passwordHash), points: user.points, referralCode: user.referralCode, profileSetupComplete: user.profileSetupComplete !== false, createdAt: user.createdAt };
}

function createSession(state: AuthState, userId: string) {
  const token = randomBytes(32).toString("base64url");
  state.sessions[sessionKey(token)] = { userId, expiresAt: Date.now() + SESSION_TTL_MS };
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function matchesPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }
export function isValidEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) && email.length <= 254; }

export function validateUsername(username: string) {
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return "Use 3–24 letters, numbers, or underscores.";
  const blocked = ["fuck", "shit", "bitch", "asshole"];
  if (blocked.some((word) => username.toLowerCase().includes(word))) return "Choose a different username.";
  return "";
}

export function validatePassword(password: string) {
  if (password.length < 8 || password.length > 128) return "Password must be 8–128 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must include at least one letter and one number.";
  return "";
}

export async function issueOtp(email: string, intent: AuthIntent, clientId: string, submittedReferralCode = "") {
  return mutate((state) => {
    const accountExists = Boolean(state.emailIndex[email]);
    if (intent === "register" && accountExists) return { error: "An account already exists for this email. Log in instead." } as const;
    if (intent === "login" && !accountExists) return { error: "No account exists for this email. Create one first." } as const;
    const referralCode = normalizeReferralCode(submittedReferralCode);
    if (intent === "register" && referralCode && !state.referralIndex[referralCode]) return { error: "That referral code is not valid." } as const;
    const retryAfter = consumeRateLimit(state, `otp:${clientId}:${email}`, OTP_RATE_LIMIT);
    if (retryAfter) return { error: "Too many code requests. Please try again later.", retryAfter } as const;
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    state.otps[otpKey(email)] = { digest: digest(`code:${email}:${intent}:${code}`), intent, ...(intent === "register" && referralCode ? { referralCode } : {}), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
    return { code, expiresAt: Date.now() + OTP_TTL_MS } as const;
  });
}

export async function discardOtp(email: string) { await mutate((state) => { delete state.otps[otpKey(email)]; }); }

export async function verifyOtp(email: string, intent: AuthIntent, code: string) {
  return mutate((state) => {
    const key = otpKey(email);
    const record = state.otps[key];
    if (!record || record.expiresAt <= Date.now() || record.intent !== intent) {
      delete state.otps[key];
      return { error: "That code has expired. Request a new one." } as const;
    }
    const expected = Buffer.from(record.digest, "hex");
    const received = Buffer.from(digest(`code:${email}:${intent}:${code}`), "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      record.attempts += 1;
      const remaining = MAX_VERIFY_ATTEMPTS - record.attempts;
      if (remaining <= 0) delete state.otps[key];
      return { error: remaining > 0 ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` : "Too many incorrect attempts. Request a new code." } as const;
    }
    delete state.otps[key];
    let userId = state.emailIndex[email];
    if (intent === "register") {
      if (userId) return { error: "An account already exists for this email." } as const;
      userId = randomUUID();
      const used = new Set(Object.values(state.users).map((user) => user.username.toLowerCase()));
      const usedCodes = new Set(Object.keys(state.referralIndex));
      const referralCode = createReferralCode(usedCodes);
      const user: StoredUser = { id: userId, email, username: defaultUsername(email, used), about: "", campus: "", avatarUrl: "", isPrivate: false, hasPassword: false, points: 0, referralCode, profileSetupComplete: false, createdAt: Date.now() };
      state.users[userId] = user;
      state.emailIndex[email] = userId;
      state.referralIndex[referralCode] = userId;
      const referrer = record.referralCode ? state.users[state.referralIndex[record.referralCode]] : undefined;
      if (referrer && referrer.id !== userId) referrer.points += 10;
    }
    const user = state.users[userId];
    if (!user) return { error: "Account not found. Create an account first." } as const;
    return { user: publicUser(user), ...createSession(state, userId) } as const;
  });
}

export async function passwordLogin(email: string, password: string, clientId: string) {
  const candidate: { error: string; retryAfter?: number } | { userId: string; passwordHash: string } = await mutate((state) => {
    const retryAfter = consumeRateLimit(state, `password:${clientId}:${email}`, PASSWORD_RATE_LIMIT);
    if (retryAfter) return { error: "Too many login attempts. Please try again later.", retryAfter } as const;
    const user = state.users[state.emailIndex[email]];
    if (!user?.passwordHash) return { error: "Email or password is incorrect." } as const;
    return { userId: user.id, passwordHash: user.passwordHash } as const;
  });
  if ("error" in candidate) return candidate;
  if (!await matchesPassword(password, candidate.passwordHash)) return { error: "Email or password is incorrect." } as const;
  return mutate((state) => {
    const user = state.users[candidate.userId];
    if (!user || user.passwordHash !== candidate.passwordHash) return { error: "Email or password is incorrect." } as const;
    return { user: publicUser(user), ...createSession(state, user.id) } as const;
  });
}

export async function getSession(token?: string) {
  if (!token) return null;
  await mutationQueue;
  const state = await loadState();
  const session = state.sessions[sessionKey(token)];
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = state.users[session.userId];
  return user ? publicUser(user) : null;
}

export async function getSessionUserId(token?: string) {
  if (!token) return null;
  await mutationQueue;
  const state = await loadState();
  const session = state.sessions[sessionKey(token)];
  return session && session.expiresAt > Date.now() ? session.userId : null;
}

export async function revokeSession(token?: string) { if (token) await mutate((state) => { delete state.sessions[sessionKey(token)]; }); }

export type DirectoryUser = Pick<SessionUser, "id" | "username" | "about" | "avatarUrl" | "isPrivate">;

function directoryUser(user: StoredUser): DirectoryUser {
  return {
    id: user.id,
    username: user.username,
    about: user.isPrivate ? "" : user.about,
    avatarUrl: user.avatarUrl,
    isPrivate: Boolean(user.isPrivate),
  };
}

export async function searchUsers(viewerId: string, query: string) {
  await mutationQueue;
  const state = await loadState();
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return Object.values(state.users)
    .filter((user) => user.id !== viewerId && user.username.toLowerCase().includes(normalized))
    .sort((a, b) => {
      const aStarts = a.username.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.username.toLowerCase().startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.username.localeCompare(b.username);
    })
    .slice(0, 20)
    .map(directoryUser);
}

export async function getDirectoryUser(userId: string) {
  await mutationQueue;
  const state = await loadState();
  const user = state.users[userId];
  return user ? directoryUser(user) : null;
}

export async function getDirectoryUsers(userIds: string[]) {
  await mutationQueue;
  const state = await loadState();
  const users = new Map<string, DirectoryUser>();
  for (const userId of userIds) {
    const user = state.users[userId];
    if (user) users.set(userId, directoryUser(user));
  }
  return users;
}

export type EventAttendeeUser = Pick<SessionUser, "id" | "username" | "email">;

export async function getEventAttendeeUsers(userIds: string[]) {
  await mutationQueue;
  const state = await loadState();
  const users = new Map<string, EventAttendeeUser>();
  for (const userId of userIds) {
    const user = state.users[userId];
    if (user) users.set(userId, { id: user.id, username: user.username, email: user.email });
  }
  return users;
}

export async function updatePrivacy(userId: string, isPrivate: boolean) {
  return mutate((state) => {
    const user = state.users[userId];
    if (!user) return { error: "Account not found." } as const;
    user.isPrivate = isPrivate;
    return { user: publicUser(user) } as const;
  });
}

export async function updateProfile(userId: string, username: string, about: string, campus: string) {
  if (campus.trim() && !await isKnownIndianCampus(campus)) return { error: "Select a campus from the Indian campus directory." } as const;
  return mutate((state) => {
    const user = state.users[userId];
    if (!user) return { error: "Account not found." } as const;
    const usernameError = validateUsername(username);
    if (usernameError) return { error: usernameError } as const;
    if (about.length > 500) return { error: "About must be 500 characters or fewer." } as const;
    if (campus.length > 180) return { error: "Campus names must be 180 characters or fewer." } as const;
    const taken = Object.values(state.users).some((candidate) => candidate.id !== userId && candidate.username.toLowerCase() === username.toLowerCase());
    if (taken) return { error: "That username is already taken." } as const;
    user.username = username;
    user.about = about.trim();
    user.campus = campus.trim();
    user.profileSetupComplete = true;
    return { user: publicUser(user) } as const;
  });
}

export async function updateAvatar(userId: string, avatarUrl: string) {
  return mutate((state) => {
    const user = state.users[userId];
    if (!user) return { error: "Account not found." } as const;
    user.avatarUrl = avatarUrl;
    return { user: publicUser(user) } as const;
  });
}

export async function setPassword(userId: string, currentPassword: string, newPassword: string) {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { error: passwordError } as const;
  await mutationQueue;
  const state = await loadState();
  const existing = state.users[userId];
  const originalHash = existing?.passwordHash;
  const currentMatches = originalHash ? await matchesPassword(currentPassword, originalHash) : true;
  if (!existing || !currentMatches) return { error: "Current password is incorrect." } as const;
  const passwordHash = await hashPassword(newPassword);
  return mutate((current) => {
    const user = current.users[userId];
    if (!user) return { error: "Account not found." } as const;
    if (user.passwordHash !== originalHash) return { error: "Your password changed in another session. Please try again." } as const;
    user.passwordHash = passwordHash;
    return { user: publicUser(user) } as const;
  });
}

export async function issueEmailChangeOtp(userId: string, newEmail: string, clientId: string) {
  return mutate((state) => {
    const user = state.users[userId];
    if (!user) return { error: "Account not found." } as const;
    if (state.emailIndex[newEmail] && state.emailIndex[newEmail] !== userId) return { error: "That email is already connected to another account." } as const;
    if (user.email === newEmail) return { error: "That is already your account email." } as const;
    const retryAfter = consumeRateLimit(state, `email-change:${clientId}:${userId}:${newEmail}`, OTP_RATE_LIMIT);
    if (retryAfter) return { error: "Too many code requests. Please try again later.", retryAfter } as const;
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    state.emailChanges[emailChangeKey(userId, newEmail)] = { digest: digest(`email-change-code:${userId}:${newEmail}:${code}`), userId, newEmail, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 };
    return { code, expiresAt: Date.now() + OTP_TTL_MS } as const;
  });
}

export async function discardEmailChangeOtp(userId: string, newEmail: string) { await mutate((state) => { delete state.emailChanges[emailChangeKey(userId, newEmail)]; }); }

export async function verifyEmailChangeOtp(userId: string, newEmail: string, code: string) {
  return mutate((state) => {
    const key = emailChangeKey(userId, newEmail);
    const record = state.emailChanges[key];
    if (!record || record.expiresAt <= Date.now()) {
      delete state.emailChanges[key];
      return { error: "That code has expired. Request a new one." } as const;
    }
    const expected = Buffer.from(record.digest, "hex");
    const received = Buffer.from(digest(`email-change-code:${userId}:${newEmail}:${code}`), "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      record.attempts += 1;
      const remaining = MAX_VERIFY_ATTEMPTS - record.attempts;
      if (remaining <= 0) delete state.emailChanges[key];
      return { error: remaining > 0 ? `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` : "Too many incorrect attempts. Request a new code." } as const;
    }
    const user = state.users[userId];
    if (!user) return { error: "Account not found." } as const;
    if (state.emailIndex[newEmail] && state.emailIndex[newEmail] !== userId) return { error: "That email is already connected to another account." } as const;
    delete state.emailChanges[key];
    delete state.emailIndex[user.email];
    user.email = newEmail;
    state.emailIndex[newEmail] = userId;
    return { user: publicUser(user) } as const;
  });
}
