import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { runTransaction, type TransactionClient } from "../transaction";

type TxClient = TransactionClient;

function synthesizePlaceholderEmail(username: string): string {
  return `placeholder+${username}@placeholder.nojv.local`;
}

async function attachPlaceholderInTx(
  tx: TxClient,
  placeholderId: string,
  realUserId: string,
): Promise<void> {
  const placeholderMemberships = await tx.courseMembership.findMany({
    where: { userId: placeholderId },
    select: { id: true, courseId: true },
  });
  for (const mem of placeholderMemberships) {
    const existing = await tx.courseMembership.findUnique({
      where: { courseId_userId: { courseId: mem.courseId, userId: realUserId } },
      select: { id: true },
    });
    if (existing) {
      await tx.courseMembership.delete({ where: { id: mem.id } });
    } else {
      await tx.courseMembership.update({
        where: { id: mem.id },
        data: { userId: realUserId },
      });
    }
  }

  await tx.courseMembership.updateMany({
    where: { addedByUserId: placeholderId },
    data: { addedByUserId: realUserId },
  });

  await tx.user.delete({ where: { id: placeholderId } });
}

export const userRepo = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  findManyByIds(ids: readonly string[]) {
    return prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  },

  listPaginated(opts: { where: Prisma.UserWhereInput; skip: number; take: number }) {
    return prisma.user.findMany({
      where: opts.where,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        platformRole: true,
        disabled: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: opts.take,
      skip: opts.skip,
    });
  },

  count(where: Prisma.UserWhereInput = {}) {
    return prisma.user.count({ where });
  },

  countAll() {
    return prisma.user.count();
  },

  groupByRole() {
    return prisma.user.groupBy({
      by: ["platformRole"],
      _count: { _all: true },
    });
  },

  listActiveIds() {
    return prisma.user.findMany({
      where: { status: "active" },
      select: { id: true },
    });
  },

  update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data,
    });
  },

  findDisabledStatus(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { disabled: true, isSuperAdmin: true },
    });
  },

  async countDeletionBlockers(id: string): Promise<number> {
    const [ownedCourses, createdAssessments] = await Promise.all([
      prisma.course.count({ where: { ownerId: id } }),
      prisma.assessment.count({ where: { createdByUserId: id } }),
    ]);
    return ownedCourses + createdAssessments;
  },

  delete(id: string) {
    return prisma.user.delete({ where: { id } });
  },

  anonymizeAndDisable(id: string) {
    return prisma.user.update({
      where: { id },
      data: {
        disabled: true,
        isSuperAdmin: false,
        platformRole: "student",
        username: null,
        displayUsername: null,
        image: null,
        name: "Deleted user",
        email: `deleted+${id}@deleted.nojv.local`,
      },
    });
  },

  createPlaceholder(input: { username: string; addedByUserId: string | null }) {
    return prisma.user.create({
      data: {
        email: synthesizePlaceholderEmail(input.username),
        username: input.username,
        displayUsername: input.username,
        name: input.username,
        emailVerified: false,
        status: "pending_first_login",
        disabled: false,
        platformRole: "student",
      },
    });
  },

  async attachPlaceholderToAuth(placeholderId: string, realUserId: string) {
    if (placeholderId === realUserId) {
      throw new Error("attachPlaceholderToAuth: placeholder and real user must differ");
    }
    await runTransaction((tx) => attachPlaceholderInTx(tx, placeholderId, realUserId));
  },

  attachPlaceholderInTx(tx: TxClient, placeholderId: string, realUserId: string) {
    if (placeholderId === realUserId) {
      throw new Error("attachPlaceholderInTx: placeholder and real user must differ");
    }
    return attachPlaceholderInTx(tx, placeholderId, realUserId);
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.user.findUnique({ where: { id } });
      },

      findByUsername(username: string) {
        return tx.user.findUnique({ where: { username } });
      },

      create(data: Prisma.UserCreateInput) {
        return tx.user.create({ data });
      },

      update(id: string, data: Prisma.UserUpdateInput) {
        return tx.user.update({ data, where: { id } });
      },
    };
  },
};
