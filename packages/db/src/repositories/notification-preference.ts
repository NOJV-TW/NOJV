import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export type NotificationPreferenceValues = Omit<
  Prisma.NotificationPreferenceUncheckedCreateInput,
  "userId"
>;

export const notificationPreferenceRepo = {
  get(userId: string) {
    return prisma.notificationPreference.findUnique({ where: { userId } });
  },

  upsert(userId: string, prefs: NotificationPreferenceValues) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...prefs },
      update: { ...prefs },
    });
  },

  findManyByUserIds(userIds: string[]) {
    if (userIds.length === 0) return Promise.resolve([]);
    return prisma.notificationPreference.findMany({
      where: { userId: { in: userIds } },
    });
  },
};
