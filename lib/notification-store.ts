import "server-only";

import { createHash } from "node:crypto";
import { mutateDocument, readDocument } from "@/lib/firebase-admin";
import type { NotificationType, UserNotification } from "@/lib/types";

type NotificationDatabase = {
  version: 1;
  notifications: Record<string, UserNotification>;
};

export type NewNotification = {
  recipientId: string;
  senderId?: string | null;
  type: NotificationType;
  content: string;
  link: string;
  dedupeKey: string;
};

const STORE_DOC = process.env.NOTIFICATIONS_STORE_DOC || "notifications";
const MAX_NOTIFICATIONS_PER_USER = 100;
const emptyDatabase = (): NotificationDatabase => ({ version: 1, notifications: {} });
let writeQueue: Promise<unknown> = Promise.resolve();

function hydrate(value: Partial<NotificationDatabase> | null): NotificationDatabase {
  return value?.notifications ? { version: 1, notifications: value.notifications } : emptyDatabase();
}

function notificationId(recipientId: string, dedupeKey: string) {
  return createHash("sha256").update(`${recipientId}:${dedupeKey}`).digest("hex").slice(0, 32);
}

function mutate<T>(action: (database: NotificationDatabase) => T | Promise<T>): Promise<T> {
  const operation = writeQueue.then(async () => {
    let result!: T;
    await mutateDocument<Partial<NotificationDatabase>, NotificationDatabase>(STORE_DOC, async (current) => {
      const database = hydrate(current);
      result = await action(database);
      return database;
    });
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function pruneRecipient(database: NotificationDatabase, recipientId: string) {
  const items = Object.values(database.notifications)
    .filter((item) => item.recipientId === recipientId)
    .sort((a, b) => b.createdAt - a.createdAt);
  for (const item of items.slice(MAX_NOTIFICATIONS_PER_USER)) delete database.notifications[item.id];
}

export async function createNotifications(input: NewNotification | NewNotification[]) {
  const inputs = Array.isArray(input) ? input : [input];
  return mutate((database) => {
    const created: UserNotification[] = [];
    const now = Date.now();
    for (const candidate of inputs) {
      if (!candidate.recipientId || !candidate.content.trim() || !candidate.link.trim()) continue;
      const id = notificationId(candidate.recipientId, candidate.dedupeKey);
      if (database.notifications[id]) continue;
      const notification: UserNotification = {
        id,
        recipientId: candidate.recipientId,
        senderId: candidate.senderId || null,
        type: candidate.type,
        content: candidate.content.trim(),
        link: candidate.link.trim(),
        isRead: false,
        createdAt: now,
      };
      database.notifications[id] = notification;
      created.push(notification);
    }
    for (const recipientId of new Set(inputs.map((item) => item.recipientId).filter(Boolean))) pruneRecipient(database, recipientId);
    return created;
  });
}

export async function createNotification(input: NewNotification) {
  return (await createNotifications(input))[0] || null;
}

export async function listNotifications(recipientId: string, limit = 50) {
  await writeQueue;
  const database = hydrate(await readDocument<Partial<NotificationDatabase>>(STORE_DOC));
  const notifications = Object.values(database.notifications)
    .filter((item) => item.recipientId === recipientId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { notifications: notifications.slice(0, Math.min(100, Math.max(1, limit))), unreadCount: notifications.filter((item) => !item.isRead).length };
}

export async function markNotificationRead(recipientId: string, notificationIdValue: string) {
  return mutate((database) => {
    const notification = database.notifications[notificationIdValue];
    if (!notification || notification.recipientId !== recipientId) return { error: "Notification not found.", status: 404 } as const;
    notification.isRead = true;
    return { notification } as const;
  });
}

export async function markAllNotificationsRead(recipientId: string) {
  return mutate((database) => {
    let updated = 0;
    for (const notification of Object.values(database.notifications)) {
      if (notification.recipientId !== recipientId || notification.isRead) continue;
      notification.isRead = true;
      updated += 1;
    }
    return { updated } as const;
  });
}

export async function deleteUserNotifications(userId: string) {
  return mutate((database) => {
    for (const notification of Object.values(database.notifications)) {
      if (notification.recipientId === userId) delete database.notifications[notification.id];
      else if (notification.senderId === userId) notification.senderId = null;
    }
    return { removed: true } as const;
  });
}
