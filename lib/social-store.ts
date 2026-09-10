import { randomUUID } from "node:crypto";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import type { ChatMessage } from "@/lib/types";

export type FollowStatus = "pending" | "accepted" | "rejected";
export type ChatRequestStatus = "pending" | "accepted" | "rejected";

export type FollowRecord = {
  id: string;
  followerId: string;
  targetUserId: string;
  status: FollowStatus;
  createdAt: number;
  respondedAt?: number;
};

export type ChatRequestRecord = {
  id: string;
  pairKey: string;
  senderId: string;
  recipientId: string;
  initialMessage: string;
  status: ChatRequestStatus;
  createdAt: number;
  respondedAt?: number;
};

type ConversationRecord = { id: string; pairKey: string; createdAt: number; updatedAt: number };
type ConversationMemberRecord = { conversationId: string; userId: string; joinedAt: number };

type SocialDatabase = {
  version: 1;
  follows: Record<string, FollowRecord>;
  chatRequests: Record<string, ChatRequestRecord>;
  conversations: Record<string, ConversationRecord>;
  conversationMembers: Record<string, ConversationMemberRecord>;
  messages: Record<string, ChatMessage & { conversationId: string }>;
};

const STORE_DOC = process.env.SOCIAL_STORE_DOC || "social";
const emptyDatabase = (): SocialDatabase => ({ version: 1, follows: {}, chatRequests: {}, conversations: {}, conversationMembers: {}, messages: {} });
let writeQueue: Promise<unknown> = Promise.resolve();

function pairKey(firstUserId: string, secondUserId: string) {
  return [firstUserId, secondUserId].sort().join(":");
}

function hydrate(stored: Partial<SocialDatabase> | null): SocialDatabase {
  return stored ? { ...emptyDatabase(), ...stored } : emptyDatabase();
}

async function loadDatabase() {
  return hydrate(await readDocument<Partial<SocialDatabase>>(STORE_DOC));
}

function mutate<T>(action: (database: SocialDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<SocialDatabase>, SocialDatabase>(STORE_DOC, async (current) => {
      const database = hydrate(current);
      result = await action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function getRelationshipStates(viewerId: string, targetIds: string[]) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.fromEntries(targetIds.map((targetId) => {
    const follow = Object.values(database.follows).find((record) => record.followerId === viewerId && record.targetUserId === targetId);
    const key = pairKey(viewerId, targetId);
    const conversation = Object.values(database.conversations).find((record) => record.pairKey === key);
    const request = Object.values(database.chatRequests).find((record) => record.pairKey === key);
    const chatStatus = conversation || request?.status === "accepted"
      ? "connected"
      : request?.status === "rejected"
        ? "rejected"
        : request?.status === "pending"
          ? request.senderId === viewerId ? "pending_sent" : "pending_received"
          : "none";
    return [targetId, { followStatus: follow?.status || "none", chatStatus }];
  })) as Record<string, { followStatus: FollowStatus | "none"; chatStatus: "none" | "pending_sent" | "pending_received" | "rejected" | "connected" }>;
}

export async function followUser(followerId: string, targetUserId: string, targetIsPrivate: boolean) {
  return mutate((database) => {
    if (followerId === targetUserId) return { error: "You cannot follow yourself.", status: 400 } as const;
    const existing = Object.values(database.follows).find((record) => record.followerId === followerId && record.targetUserId === targetUserId);
    if (existing?.status === "accepted") return { follow: existing, alreadyExisted: true } as const;
    if (existing?.status === "pending") return { error: "Your follow request is already pending.", status: 409 } as const;
    if (existing?.status === "rejected") return { error: "This follow request was previously declined.", status: 409 } as const;
    const follow: FollowRecord = {
      id: randomUUID(),
      followerId,
      targetUserId,
      status: targetIsPrivate ? "pending" : "accepted",
      createdAt: Date.now(),
      ...(targetIsPrivate ? {} : { respondedAt: Date.now() }),
    };
    database.follows[follow.id] = follow;
    return { follow, alreadyExisted: false } as const;
  });
}

export async function listIncomingFollowRequests(targetUserId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.follows)
    .filter((record) => record.targetUserId === targetUserId && record.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function resolveFollowRequest(requestId: string, targetUserId: string, decision: "accepted" | "rejected") {
  return mutate((database) => {
    const follow = database.follows[requestId];
    if (!follow || follow.targetUserId !== targetUserId) return { error: "Follow request not found.", status: 404 } as const;
    if (follow.status !== "pending") return { error: "This follow request has already been handled.", status: 409 } as const;
    follow.status = decision;
    follow.respondedAt = Date.now();
    return { follow } as const;
  });
}

export async function countFollowers(userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.follows).filter((record) => record.targetUserId === userId && record.status === "accepted").length;
}

export function validateInitialMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Write one initial message before sending.";
  if (trimmed.length > 1_000) return "The initial message must be 1,000 characters or fewer.";
  return "";
}

export async function createChatRequest(senderId: string, recipientId: string, initialMessage: string) {
  return mutate((database) => {
    if (senderId === recipientId) return { error: "You cannot send a chat request to yourself.", status: 400 } as const;
    const validationError = validateInitialMessage(initialMessage);
    if (validationError) return { error: validationError, status: 400 } as const;
    const key = pairKey(senderId, recipientId);
    const conversation = Object.values(database.conversations).find((record) => record.pairKey === key);
    if (conversation) return { error: "You are already connected in Messages.", status: 409 } as const;
    const existing = Object.values(database.chatRequests).find((record) => record.pairKey === key);
    if (existing?.status === "pending") return { error: "A message request is already pending for this person.", status: 409 } as const;
    if (existing?.status === "rejected") return { error: "A rejected message request cannot be sent again.", status: 409 } as const;
    if (existing?.status === "accepted") return { error: "You are already connected in Messages.", status: 409 } as const;
    const request: ChatRequestRecord = {
      id: randomUUID(),
      pairKey: key,
      senderId,
      recipientId,
      initialMessage: initialMessage.trim(),
      status: "pending",
      createdAt: Date.now(),
    };
    database.chatRequests[request.id] = request;
    return { request } as const;
  });
}

export async function listIncomingChatRequests(recipientId: string) {
  await writeQueue;
  const database = await loadDatabase();
  return Object.values(database.chatRequests)
    .filter((record) => record.recipientId === recipientId && record.status === "pending")
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function resolveChatRequest(requestId: string, recipientId: string, decision: "accepted" | "rejected") {
  return mutate((database) => {
    const request = database.chatRequests[requestId];
    if (!request || request.recipientId !== recipientId) return { error: "Message request not found.", status: 404 } as const;
    if (request.status !== "pending") return { error: "This message request has already been handled.", status: 409 } as const;
    request.status = decision;
    request.respondedAt = Date.now();
    if (decision === "rejected") return { request } as const;

    const now = Date.now();
    const conversation: ConversationRecord = { id: randomUUID(), pairKey: request.pairKey, createdAt: now, updatedAt: now };
    database.conversations[conversation.id] = conversation;
    for (const userId of [request.senderId, request.recipientId]) {
      database.conversationMembers[`${conversation.id}:${userId}`] = { conversationId: conversation.id, userId, joinedAt: now };
    }
    const message: ChatMessage & { conversationId: string } = { id: randomUUID(), conversationId: conversation.id, senderId: request.senderId, body: request.initialMessage, createdAt: request.createdAt };
    database.messages[message.id] = message;
    return { request, conversation, message } as const;
  });
}

export async function listUserConversations(userId: string) {
  await writeQueue;
  const database = await loadDatabase();
  const conversationIds = new Set(Object.values(database.conversationMembers).filter((member) => member.userId === userId).map((member) => member.conversationId));
  return Object.values(database.conversations)
    .filter((conversation) => conversationIds.has(conversation.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((conversation) => {
      const members = Object.values(database.conversationMembers).filter((member) => member.conversationId === conversation.id);
      const otherUserId = members.find((member) => member.userId !== userId)?.userId || userId;
      const messages = Object.values(database.messages)
        .filter((message) => message.conversationId === conversation.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ conversationId, ...message }) => { void conversationId; return message; });
      return { ...conversation, otherUserId, messages };
    });
}

export async function sendConversationMessage(conversationId: string, senderId: string, body: string) {
  return mutate((database) => {
    const conversation = database.conversations[conversationId];
    const member = database.conversationMembers[`${conversationId}:${senderId}`];
    if (!conversation || !member) return { error: "Conversation not found.", status: 404 } as const;
    const validationError = validateInitialMessage(body);
    if (validationError) return { error: validationError, status: 400 } as const;
    const message: ChatMessage & { conversationId: string } = { id: randomUUID(), conversationId, senderId, body: body.trim(), createdAt: Date.now() };
    database.messages[message.id] = message;
    conversation.updatedAt = message.createdAt;
    const { conversationId: omittedConversationId, ...visible } = message;
    void omittedConversationId;
    return { message: visible } as const;
  });
}
