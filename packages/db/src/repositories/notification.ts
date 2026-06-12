import { prisma } from "../client";
import { Prisma, type NotificationType } from "../../generated/prisma/client";

export const NOTIFICATION_RETENTION_PER_USER = 50;

export interface NotificationCreateInput {
  userId: string;
  type: NotificationType;
  params: Prisma.InputJsonValue;
  linkUrl?: string | null;
  dedupeKey?: string | null;
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

  async createAndCap(input: NotificationCreateInput) {
    if (input.dedupeKey != null) {
      const existing = await prisma.notification.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) return existing;
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const row = await tx.notification.create({
          data: {
            userId: input.userId,
            type: input.type,
            params: input.params,
            linkUrl: input.linkUrl ?? null,
            dedupeKey: input.dedupeKey ?? null,
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
    } catch (err) {
      if (
        input.dedupeKey != null &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.notification.findUnique({
          where: { dedupeKey: input.dedupeKey },
        });
        if (existing) return existing;
      }
      throw err;
    }
  },

  async createManyAndCap(inputs: NotificationCreateInput[]) {
    if (inputs.length === 0) return 0;
    const result = await prisma.notification.createMany({
      data: inputs.map((i) => ({
        userId: i.userId,
        type: i.type,
        params: i.params,
        linkUrl: i.linkUrl ?? null,
        dedupeKey: i.dedupeKey ?? null,
      })),
      skipDuplicates: true,
    });

    const userIds = Array.from(new Set(inputs.map((i) => i.userId)));
    await capRetentionForUsers(userIds);

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
    await capRetentionForUsers([userId]);
    return row.count;
  },

  async deleteOne(userId: string, notificationId: string) {
    const result = await prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    return result.count;
  },

  async deleteAll(userId: string, opts?: { onlyRead?: boolean }) {
    const result = await prisma.notification.deleteMany({
      where: {
        userId,
        ...(opts?.onlyRead ? { readAt: { not: null } } : {}),
      },
    });
    return result.count;
  },
};

async function capRetentionForUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.$executeRaw`
    DELETE FROM "Notification"
    WHERE "id" IN (
      SELECT "id" FROM (
        SELECT "id",
          ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS rn
        FROM "Notification"
        WHERE "userId" IN (${Prisma.join(userIds)})
      ) ranked
      WHERE rn > ${NOTIFICATION_RETENTION_PER_USER}
    )
  `;
}
