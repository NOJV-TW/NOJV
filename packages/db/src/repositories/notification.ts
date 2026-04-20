import { prisma } from "../client";
import type { Prisma, NotificationType } from "../../generated/prisma/client";

export const NOTIFICATION_RETENTION_PER_USER = 50;

export interface NotificationCreateInput {
  userId: string;
  type: NotificationType;
  params: Prisma.InputJsonValue;
  linkUrl?: string | null;
}

export const notificationRepo = {
  listRecent(userId: string, limit: number) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  countUnread(userId: string) {
    return prisma.notification.count({ where: { userId, readAt: null } });
  },

  // Single-user insert + capped cleanup in one transaction.
  async createAndCap(input: NotificationCreateInput) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          params: input.params,
          linkUrl: input.linkUrl ?? null,
        },
      });

      await tx.$executeRaw`
        DELETE FROM "Notification"
        WHERE "id" IN (
          SELECT "id" FROM "Notification"
          WHERE "userId" = ${input.userId}
          ORDER BY "createdAt" DESC
          OFFSET ${NOTIFICATION_RETENTION_PER_USER}
        )
      `;

      return row;
    });
  },

  // Batch insert for fan-outs; caller splits into chunks of 500 upstream.
  async createManyAndCap(inputs: NotificationCreateInput[]) {
    if (inputs.length === 0) return 0;
    const result = await prisma.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        type: i.type,
        params: i.params,
        linkUrl: i.linkUrl ?? null,
      })),
    });

    const userIds = Array.from(new Set(inputs.map((i) => i.userId)));
    for (const userId of userIds) {
      await prisma.$executeRaw`
        DELETE FROM "Notification"
        WHERE "id" IN (
          SELECT "id" FROM "Notification"
          WHERE "userId" = ${userId}
          ORDER BY "createdAt" DESC
          OFFSET ${NOTIFICATION_RETENTION_PER_USER}
        )
      `;
    }

    return result.count;
  },

  async markRead(userId: string, notificationId: string) {
    const row = await prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return row.count;
  },

  async markAllRead(userId: string) {
    const row = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return row.count;
  },
};
