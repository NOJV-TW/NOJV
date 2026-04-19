import { notificationRepo, type NotificationCreateInput } from "@nojv/db";
import { pubsub } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

export type CreateNotificationInput = NotificationCreateInput;

function toSseEvent(row: {
  id: string;
  type: string;
  params: unknown;
  linkUrl: string | null;
  createdAt: Date;
}): NotificationSSEEvent {
  return {
    type: SSE_NOTIFICATION,
    id: row.id,
    notificationType: row.type,
    params: row.params,
    linkUrl: row.linkUrl,
    createdAt: row.createdAt.toISOString()
  };
}

export async function createNotification(input: CreateNotificationInput) {
  const row = await notificationRepo.createAndCap(input);
  await pubsub.publishNotification(input.userId, toSseEvent(row));
  return row;
}

export async function createNotificationBatch(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < inputs.length; i += BATCH) {
    total += await notificationRepo.createManyAndCap(inputs.slice(i, i + BATCH));
  }

  // One signal per unique userId — clients refetch /api/notifications/recent
  // regardless of how many rows landed, so per-row publishes would be waste.
  // Pick the first row's detail as a sample payload for debugging in Redis logs.
  const firstPerUser = new Map<string, CreateNotificationInput>();
  for (const input of inputs) {
    if (!firstPerUser.has(input.userId)) firstPerUser.set(input.userId, input);
  }
  for (const [userId, sample] of firstPerUser) {
    await pubsub.publishNotificationBatchSignal(userId, {
      notificationType: sample.type,
      params: sample.params,
      linkUrl: sample.linkUrl ?? null
    });
  }

  return total;
}

export async function listRecent(userId: string, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return notificationRepo.listRecent(userId, safeLimit);
}

export async function countUnread(userId: string) {
  return notificationRepo.countUnread(userId);
}

export async function markAsRead(userId: string, notificationId: string) {
  return notificationRepo.markRead(userId, notificationId);
}

export async function markAllAsRead(userId: string) {
  return notificationRepo.markAllRead(userId);
}
