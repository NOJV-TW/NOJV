import { isDeepStrictEqual } from "node:util";

import { prisma } from "../client";
import { Prisma, type NotificationType } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

export const NOTIFICATION_RETENTION_PER_USER = 50;

export interface NotificationCreateInput {
  userId: string;
  type: NotificationType;
  params: Prisma.InputJsonValue;
  linkUrl?: string | null;
  dedupeKey?: string | null;
}

export class NotificationDedupeConflictError extends Error {
  constructor(dedupeKey: string) {
    super(`Notification dedupe key was reused with different content: ${dedupeKey}`);
    this.name = "NotificationDedupeConflictError";
  }
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
    await capRetentionForUsers(prisma, [userId]);
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

  withTx(tx: TransactionClient) {
    return {
      async createAndCap(input: NotificationCreateInput) {
        const created = await tx.notification.createManyAndReturn({
          data: [notificationData(input)],
          skipDuplicates: true,
        });
        const row =
          created[0] ??
          (input.dedupeKey
            ? await tx.notification.findUniqueOrThrow({
                where: { dedupeKey: input.dedupeKey },
              })
            : null);
        if (!row) {
          throw new Error("Notification insert returned no row without a dedupe key.");
        }
        if (!created[0]) assertCanonicalNotification(row, input);
        await capRetentionForUsers(tx, [input.userId]);
        return { row, created: created.length === 1 };
      },

      async createManyAndCap(inputs: readonly NotificationCreateInput[]) {
        if (inputs.length === 0) return [];
        const keyedInputs = inputs.filter(
          (input): input is NotificationCreateInput & { dedupeKey: string } =>
            input.dedupeKey != null,
        );
        if (new Set(keyedInputs.map((input) => input.dedupeKey)).size !== keyedInputs.length) {
          throw new RangeError("Notification batch dedupe keys must be unique.");
        }
        const rows = await tx.notification.createManyAndReturn({
          data: inputs.map(notificationData),
          skipDuplicates: true,
        });
        if (keyedInputs.length > 0) {
          const stored = await tx.notification.findMany({
            where: { dedupeKey: { in: keyedInputs.map((input) => input.dedupeKey) } },
          });
          const byKey = new Map(stored.map((row) => [row.dedupeKey, row]));
          for (const input of keyedInputs) {
            const row = byKey.get(input.dedupeKey);
            if (!row)
              throw new Error(`Notification disappeared after insert: ${input.dedupeKey}`);
            assertCanonicalNotification(row, input);
          }
        }
        await capRetentionForUsers(tx, [...new Set(inputs.map((input) => input.userId))]);
        return rows;
      },
    };
  },
};

function notificationData(input: NotificationCreateInput) {
  return {
    userId: input.userId,
    type: input.type,
    params: input.params,
    linkUrl: input.linkUrl ?? null,
    dedupeKey: input.dedupeKey ?? null,
  } satisfies Prisma.NotificationCreateManyInput;
}

function assertCanonicalNotification(
  row: {
    userId: string;
    type: NotificationType;
    params: Prisma.JsonValue;
    linkUrl: string | null;
    dedupeKey: string | null;
  },
  input: NotificationCreateInput,
): void {
  if (
    row.userId !== input.userId ||
    row.type !== input.type ||
    row.linkUrl !== (input.linkUrl ?? null) ||
    !isDeepStrictEqual(row.params, input.params)
  ) {
    throw new NotificationDedupeConflictError(input.dedupeKey ?? "<none>");
  }
}

type NotificationRetentionClient = Pick<TransactionClient, "$executeRaw">;

async function capRetentionForUsers(
  client: NotificationRetentionClient,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await client.$executeRaw`
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
