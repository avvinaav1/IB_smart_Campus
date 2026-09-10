import { randomUUID } from "node:crypto";
import { ensureCommunityForLegacyPost, resolveCommunityForPost, visibleCommunityIds } from "@/lib/community-store";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import { posts as initialPosts } from "@/lib/data";
import type { Post, PostComment, UserDashboard } from "@/lib/types";

type StoredPost = Post & {
  authorId: string;
  userId: string;
  createdAt: number;
  clientRequestId: string;
  voteBase?: number;
  votesByUser?: Record<string, 1 | -1>;
};

type PostDatabase = {
  version: 2;
  posts: StoredPost[];
};

export type NewPostInput = {
  clientRequestId: string;
  communityId: string;
  flair?: string;
  title: string;
  body?: string;
  images?: string[];
};

const STORE_DOC = process.env.POSTS_STORE_DOC || "posts";
let writeQueue: Promise<unknown> = Promise.resolve();

function seededDatabase(): PostDatabase {
  const seedTime = Date.now();
  return {
    version: 2,
    posts: initialPosts.map((post, index) => ({
      ...post,
      authorId: "system",
      userId: "system",
      createdAt: seedTime - index * 60_000,
      clientRequestId: `seed-${post.id}`,
      voteBase: post.votes,
      votesByUser: {},
    })),
  };
}

function voteDelta(post: StoredPost) {
  return Object.values(post.votesByUser || {}).reduce<number>((total, vote) => total + vote, 0);
}

function voteTotal(post: StoredPost) {
  return (post.voteBase ?? post.votes - voteDelta(post)) + voteDelta(post);
}

function publicPost(post: StoredPost, viewerId: string): Post {
  const { voteBase, votesByUser, ...visible } = post;
  return {
    ...visible,
    votes: voteBase === undefined ? voteTotal(post) : voteBase + voteDelta(post),
    voted: votesByUser?.[viewerId],
  };
}

function postingStreak(posts: StoredPost[]) {
  const dayMs = 86_400_000;
  const activeDays = [...new Set(posts.map((post) => Math.floor(post.createdAt / dayMs)))].sort((a, b) => b - a);
  if (!activeDays.length) return 0;
  const today = Math.floor(Date.now() / dayMs);
  if (activeDays[0] < today - 1) return 0;
  let streak = 1;
  for (let index = 1; index < activeDays.length; index += 1) {
    if (activeDays[index] !== activeDays[index - 1] - 1) break;
    streak += 1;
  }
  return streak;
}

// Transaction-safe shaping: never calls another store (a nested Firestore
// transaction would deadlock). Legacy posts with no communityId keep "" here and
// are simply filtered out of feeds; the read path below backfills them for
// display via ensureCommunityForLegacyPost.
function hydrateForWrite(parsed: Partial<PostDatabase> | null): PostDatabase {
  if (!parsed || !parsed.posts) return seededDatabase();
  return {
    version: 2,
    posts: (parsed.posts || []).map((post) => ({
      ...post,
      communityId: post.communityId || "",
      authorId: post.authorId || post.userId || "system",
      userId: post.userId || post.authorId || "system",
    })) as StoredPost[],
  };
}

async function loadDatabase(): Promise<PostDatabase> {
  const parsed = await readDocument<Partial<PostDatabase>>(STORE_DOC);
  if (!parsed || !parsed.posts) return seededDatabase();
  return {
    version: 2,
    posts: await Promise.all((parsed.posts || []).map(async (post) => ({
      ...post,
      communityId: post.communityId || await ensureCommunityForLegacyPost(post.community, post.accent, post.userId || "system"),
      authorId: post.authorId || post.userId || "system",
      userId: post.userId || post.authorId || "system",
    }))) as StoredPost[],
  };
}

function mutate<T>(action: (database: PostDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<PostDatabase>, PostDatabase>(STORE_DOC, async (current) => {
      const database = hydrateForWrite(current);
      result = await action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function validatePostInput(input: NewPostInput) {
  if (!/^[0-9a-f-]{36}$/i.test(input.clientRequestId)) return "The post request identifier is invalid.";
  if (!/^(?:c\/[a-z0-9][a-z0-9-]{1,39}|seed-[a-z0-9-]+|[0-9a-f-]{36})$/i.test(input.communityId)) return "Choose a valid community.";
  if (!input.title.trim() || input.title.trim().length > 160) return "Post titles must be between 1 and 160 characters.";
  if ((input.body || "").length > 10_000) return "Post text must be 10,000 characters or fewer.";
  if ((input.flair || "").length > 40) return "Post flair must be 40 characters or fewer.";
  if ((input.images || []).length > 6) return "You can attach up to 6 images.";
  const invalidImage = (input.images || []).some((image) => !/^\/api\/posts\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image));
  if (invalidImage) return "Attach images with the uploader before posting.";
  return "";
}

export function validateCommentBody(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return "Write a reply before posting.";
  if (trimmed.length > 1_000) return "Replies must be 1,000 characters or fewer.";
  return "";
}

export async function listPosts(viewerId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const communityIds = await visibleCommunityIds();
  return database.posts
    .filter((post) => communityIds.has(post.communityId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((post) => publicPost(post, viewerId));
}

export async function getUserDashboard(userId: string): Promise<UserDashboard> {
  await writeQueue;
  const database = await loadDatabase();
  const owned = database.posts.filter((post) => post.authorId === userId).sort((a, b) => b.createdAt - a.createdAt);
  return {
    karma: owned.reduce((total, post) => total + voteTotal(post), 0),
    postCount: owned.length,
    followers: 0,
    streak: postingStreak(owned),
    posts: owned.map((post) => publicPost(post, userId)),
  };
}

export async function createPost(userId: string, author: string, input: NewPostInput) {
  const resolved = await resolveCommunityForPost(input.communityId, userId);
  if ("error" in resolved) return resolved;
  const targetCommunity = resolved.community;
  return mutate((database) => {
    const duplicate = database.posts.find((post) => post.userId === userId && post.clientRequestId === input.clientRequestId);
    if (duplicate) return { post: publicPost(duplicate, userId) } as const;
    const maxId = database.posts.reduce((highest, post) => Math.max(highest, Number(post.id) || 0), 0);
    const post: StoredPost = {
      id: Math.max(Date.now(), maxId + 1),
      communityId: targetCommunity.id,
      authorId: userId,
      userId,
      clientRequestId: input.clientRequestId,
      createdAt: Date.now(),
      community: targetCommunity.name,
      accent: targetCommunity.color,
      author,
      time: "now",
      flair: input.flair,
      title: input.title.trim(),
      body: input.body?.trim() || undefined,
      images: input.images?.length ? input.images : undefined,
      votes: 0,
      comments: 0,
      voteBase: 0,
      votesByUser: {},
    };
    database.posts.push(post);
    return { post: publicPost(post, userId) } as const;
  });
}

export async function createComment(postId: number, userId: string, author: string, body: string) {
  return mutate((database) => {
    const post = database.posts.find((candidate) => candidate.id === postId);
    if (!post) return { error: "That post no longer exists." } as const;
    const comment: PostComment = {
      id: randomUUID(),
      postId,
      userId,
      author,
      body: body.trim(),
      createdAt: Date.now(),
    };
    post.commentItems = [...(post.commentItems || []), comment];
    post.comments += 1;
    return { post: publicPost(post, userId), comment } as const;
  });
}

export async function setPostVote(postId: number, userId: string, vote: 1 | -1 | null) {
  return mutate((database) => {
    const post = database.posts.find((candidate) => candidate.id === postId);
    if (!post) return { error: "That post no longer exists." } as const;
    post.voteBase ??= post.votes - voteDelta(post);
    post.votesByUser ??= {};
    if (vote === null) delete post.votesByUser[userId];
    else post.votesByUser[userId] = vote;
    post.votes = post.voteBase + voteDelta(post);
    return { post: publicPost(post, userId) } as const;
  });
}
