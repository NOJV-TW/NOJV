import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { runTransaction, type TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * Synthetic email used for placeholder rows. Teachers adding students
 * by handle don't know the real email, and better-auth requires a
 * unique non-null email per row. The `@placeholder.nojv.local` domain
 * is reserved for this purpose — `attachPlaceholderToAuth` replaces it
 * with the real OAuth email when the student first logs in.
 */
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

  /**
   * Create a placeholder `User` row for a handle pasted by a teacher.
   * Spec §5.3. The row carries `status: pending_first_login` so the
   * real student can auto-merge into it via `attachPlaceholderToAuth`
   * on their first OAuth login.
   *
   * `addedByUserId` is stored on the placeholder's `name` prefix only
   * for audit visibility — the FK reference lives on the
   * `CourseMembership` row the caller creates alongside this user.
   */
  createPlaceholder(input: { username: string; addedByUserId: string | null }) {
    return prisma.user.create({
      data: {
        email: synthesizePlaceholderEmail(input.username),
        username: input.username,
        displayUsername: input.username,
        name: input.username,
        emailVerified: false,
        status: "pending_first_login",
        // Placeholders cannot sign in: no Account row is ever created
        // and `disabled` stays false so the admin UI shows them as a
        // normal pending row rather than an admin-locked one.
        disabled: false,
        platformRole: "student"
      }
    });
  },

  /**
   * Merge a placeholder user into a freshly-created real user. Called
   * from the better-auth `databaseHooks.user.create.after` hook when
   * an OAuth signup's derived handle matches an existing placeholder.
   *
   * Transfers all `CourseMembership` rows (and `addedByUserId`
   * back-references) from the placeholder to the real user, then
   * deletes the placeholder row. Handles the `(courseId, userId)`
   * unique-conflict case by dropping the duplicate placeholder
   * membership — the real user was somehow already a member of that
   * course, so the placeholder's row is redundant.
   *
   * Runs in a transaction so the hook either attaches cleanly or
   * leaves the placeholder untouched.
   */
  async attachPlaceholderToAuth(placeholderId: string, realUserId: string) {
    if (placeholderId === realUserId) {
      throw new Error("attachPlaceholderToAuth: placeholder and real user must differ");
    }
    await runTransaction(async (tx) => {
      // Course memberships where the placeholder is the member.
      // Walk each one so we can skip the duplicate case individually
      // instead of losing the whole batch to a single conflict.
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

      // Rewrite `addedBy` back-references so audit history points at
      // the real user (trivial: just an FK, no uniqueness to worry
      // about).
      await tx.courseMembership.updateMany({
        where: { addedByUserId: placeholderId },
        data: { addedByUserId: realUserId }
      });

      // Finally, drop the placeholder row. By now it has no
      // `CourseMembership` rows referencing it as the member.
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
