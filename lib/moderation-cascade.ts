import "server-only";

import { deleteAuthUser, getAdminUser } from "@/lib/auth-store";
import { communitiesCreatedBy, communityDeletionOrder, deleteCommunityRecord, removeUserCommunityMemberships } from "@/lib/community-store";
import { deleteEventsForCommunity, deleteEventRecord, deleteUserEventData, eventRecordsCreatedBy, eventRecordsForCommunity } from "@/lib/event-store";
import { deleteImage } from "@/lib/image-storage";
import { deletePostsForCommunity, deletePostRecord, deleteUserPostData } from "@/lib/post-store";
import { deleteUserSocialData } from "@/lib/social-store";
import { detachDeletedEventFromCertificates, detachDeletedUserFromCertificates } from "@/lib/certificates/moderation";
import { deleteUserNotifications } from "@/lib/notification-store";

function imageObjectPath(url: string) {
  const match = url.match(/^\/api\/(profile\/avatar|posts\/images|events\/images|communities\/images)\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/i);
  if (!match) return "";
  const folder = match[1] === "profile/avatar" ? "avatars" : match[1] === "posts/images" ? "post-uploads" : match[1] === "events/images" ? "event-uploads" : "community-uploads";
  return `${folder}/${match[2]}`;
}

async function cleanupImages(urls: string[]) {
  await Promise.all(urls.map(imageObjectPath).filter(Boolean).map((path) => deleteImage(path)));
}

export async function cascadeDeleteEvent(eventId: string, expectedCommunityId?: string | null) {
  await detachDeletedEventFromCertificates(eventId);
  const result = await deleteEventRecord(eventId, expectedCommunityId);
  if ("error" in result) return result;
  if (!result.deleted) return result;
  await cleanupImages([result.imageUrl]);
  return result;
}

export async function cascadeDeletePost(postId: number, expectedCommunityId?: string) {
  const result = await deletePostRecord(postId, expectedCommunityId);
  if ("error" in result) return result;
  if (result.deleted) await cleanupImages(result.imageUrls);
  return result;
}

export async function cascadeDeleteCommunity(communityId: string) {
  const deletionOrder = await communityDeletionOrder(communityId);
  if (!deletionOrder.length) return { deleted: false, communityIds: [] as string[], eventIds: [] as string[] };
  const deletedCommunityIds: string[] = [];
  const deletedEventIds: string[] = [];
  const imageUrls: string[] = [];
  for (const targetId of deletionOrder) {
    const existingEvents = await eventRecordsForCommunity(targetId);
    for (const event of existingEvents) await detachDeletedEventFromCertificates(event.eventId);
    const eventAssets = await deleteEventsForCommunity(targetId);
    const postImages = await deletePostsForCommunity(targetId);
    const community = await deleteCommunityRecord(targetId);
    if (community.deleted) deletedCommunityIds.push(targetId);
    deletedEventIds.push(...eventAssets.map((event) => event.eventId));
    imageUrls.push(...eventAssets.map((event) => event.imageUrl), ...postImages, ...community.imageUrls);
  }
  await cleanupImages(imageUrls);
  return { deleted: deletedCommunityIds.includes(communityId), communityIds: deletedCommunityIds, eventIds: deletedEventIds };
}

export async function cascadeDeleteUser(userId: string) {
  const target = await getAdminUser(userId);
  if (!target) return { deleted: false } as const;
  if (target.protected) return { error: "The permanent Super Admin account cannot be deleted.", status: 403 } as const;
  const createdCommunities = await communitiesCreatedBy(userId);
  for (const communityId of createdCommunities) await cascadeDeleteCommunity(communityId);
  const authoredEvents = await eventRecordsCreatedBy(userId);
  for (const event of authoredEvents) await detachDeletedEventFromCertificates(event.eventId);
  const eventAssets = await deleteUserEventData(userId);
  const postImages = await deleteUserPostData(userId);
  await Promise.all([
    removeUserCommunityMemberships(userId),
    deleteUserSocialData(userId),
    deleteUserNotifications(userId),
  ]);
  await detachDeletedUserFromCertificates(userId);
  const auth = await deleteAuthUser(userId);
  if ("error" in auth) return auth;
  if (!auth.deleted) return { deleted: false } as const;
  await cleanupImages([...eventAssets.map((event) => event.imageUrl), ...postImages, ...(auth.avatarUrl ? [auth.avatarUrl] : [])]);
  return { deleted: true } as const;
}
