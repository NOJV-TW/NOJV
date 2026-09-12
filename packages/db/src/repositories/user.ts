import { prisma } from "../client";
import type { Prisma, PlatformRole } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const userRepo = {
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  findByUsername(username: string) {
    return prisma.user.findUnique({ where: { username } });
  },

  async securityGenerationMatches(userId: string, securityGeneration: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { securityGeneration: true },
    });
    return user?.securityGeneration === securityGeneration;
  },

  findManyByIds(ids: readonly string[]) {
    return prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
  },

  listEmailByIds(ids: readonly string[]) {
    return prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, email: true, emailVerified: true },
    });
  },

  listPaginated(opts: {
    where: Prisma.UserWhereInput;
    skip: number;
    take: number;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
  }) {
    return prisma.user.findMany({
      where: opts.where,
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        platformRole: true,
        disabled: true,
        canCreateAdvancedProblems: true,
        createdAt: true,
      },
      orderBy: opts.orderBy ?? { createdAt: "desc" },
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
      where: { disabled: false },
      select: { id: true },
    });
  },

  update(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({
      where: { id },
      data,
    });
  },

  claimOnboardingTour(id: string, role: "student" | "teacher") {
    const seenAt = new Date();
    return role === "student"
      ? prisma.user.updateMany({
          where: { id, platformRole: "student", studentTourSeenAt: null },
          data: { studentTourSeenAt: seenAt },
        })
      : prisma.user.updateMany({
          where: { id, platformRole: "teacher", teacherTourSeenAt: null },
          data: { teacherTourSeenAt: seenAt },
        });
  },

  findDisabledStatus(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { disabled: true, isSuperAdmin: true },
    });
  },

  withTx(tx: TxClient) {
    return {
      async countDeletionBlockers(id: string): Promise<number> {
        const [ownedCourses, createdAssessments, submissions, participations, memberships] =
          await Promise.all([
            tx.course.count({ where: { ownerId: id } }),
            tx.assessment.count({ where: { createdByUserId: id } }),
            tx.submission.count({ where: { userId: id } }),
            tx.participation.count({ where: { userId: id } }),
            tx.courseMembership.count({ where: { userId: id } }),
          ]);
        return ownedCourses + createdAssessments + submissions + participations + memberships;
      },

      delete(id: string) {
        return tx.user.delete({ where: { id } });
      },

      anonymizeAndDisable(id: string) {
        return tx.user.update({
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

      findById(id: string) {
        return tx.user.findUnique({ where: { id } });
      },

      findByUsername(username: string) {
        return tx.user.findUnique({ where: { username } });
      },

      listActiveIds(platformRoles?: readonly PlatformRole[]) {
        return tx.user.findMany({
          where: {
            disabled: false,
            ...(platformRoles ? { platformRole: { in: [...platformRoles] } } : {}),
          },
          select: { id: true },
        });
      },

      listEmailByIds(ids: readonly string[]) {
        return tx.user.findMany({
          where: { id: { in: [...ids] } },
          select: { id: true, email: true, emailVerified: true },
        });
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
