import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { runTransaction, type TransactionClient } from "../transaction";

type TxClient = TransactionClient;

// `@placeholder.nojv.local` is reserved; `attachPlaceholderToAuth` swaps in the real OAuth email on first login.
function synthesizePlaceholderEmail(username: string): string {
  return `placeholder+${username}@placeholder.nojv.local`;
}

export const userRepo = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
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
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: opts.take,
      skip: opts.skip
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
      _count: { _all: true }
    });
  },

  update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data
    });
  },

  findDisabledStatus(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { disabled: true }
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
        // Placeholders cannot sign in (no Account row); `disabled` stays false so they show as pending, not locked.
        disabled: false,
        platformRole: "student"
      }
    });
  },

  // Transactional merge: transfers memberships + rewrites `addedBy` refs, then deletes the placeholder.
  async attachPlaceholderToAuth(placeholderId: string, realUserId: string) {
    if (placeholderId === realUserId) {
      throw new Error("attachPlaceholderToAuth: placeholder and real user must differ");
    }
    await runTransaction(async (tx) => {
      // Walk each membership so a single `(courseId, userId)` conflict doesn't kill the whole batch.
      const placeholderMemberships = await tx.courseMembership.findMany({
        where: { userId: placeholderId },
        select: { id: true, courseId: true }
      });
      for (const mem of placeholderMemberships) {
        const existing = await tx.courseMembership.findUnique({
          where: { courseId_userId: { courseId: mem.courseId, userId: realUserId } },
          select: { id: true }
        });
        if (existing) {
          // Real user already in this course — drop the placeholder row.
          await tx.courseMembership.delete({ where: { id: mem.id } });
        } else {
          await tx.courseMembership.update({
            where: { id: mem.id },
            data: { userId: realUserId }
          });
        }
      }

      await tx.courseMembership.updateMany({
        where: { addedByUserId: placeholderId },
        data: { addedByUserId: realUserId }
      });

      await tx.user.delete({ where: { id: placeholderId } });
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.user.findUnique({ where: { id } });
      },

      create(data: Prisma.UserCreateInput) {
        return tx.user.create({ data });
      },

      update(id: string, data: Prisma.UserUpdateInput) {
        return tx.user.update({ data, where: { id } });
      }
    };
  }
};
