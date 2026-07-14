import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { userPublicSelect } from "./selects";

type TxClient = TransactionClient;

export const courseRepo = {
  findById(id: string) {
    return prisma.course.findUnique({ where: { id } });
  },

  listCards(userId?: string) {
    return prisma.course.findMany({
      include: {
        _count: {
          select: {
            assessments: { where: { status: "published" } },
            memberships: { where: { status: "active" } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      ...(userId
        ? {
            where: {
              memberships: {
                some: { userId, status: "active" },
              },
            },
          }
        : {}),
    });
  },

  findByIdWithUserMembership(id: string, userId: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { userId },
          take: 1,
        },
      },
    });
  },

  findByIdWithHeader(id: string, userId: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        memberships: {
          where: { userId },
          take: 1,
        },
        _count: {
          select: {
            memberships: { where: { role: "student", status: "active" } },
            assessments: { where: { status: "published" } },
            exams: { where: { status: "published" } },
          },
        },
      },
    });
  },

  findManyForCards(courseIds: string[]) {
    if (courseIds.length === 0) return Promise.resolve([]);
    return prisma.course.findMany({
      where: { id: { in: courseIds } },
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { name: true } },
        _count: {
          select: {
            memberships: { where: { role: "student", status: "active" } },
            assessments: { where: { status: "published" } },
            exams: { where: { status: "published" } },
          },
        },
      },
    });
  },

  count() {
    return prisma.course.count();
  },

  withTx(tx: TxClient) {
    return {
      lockForUpdate(courseId: string) {
        return tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
      },

      findById(id: string) {
        return tx.course.findUnique({ where: { id } });
      },

      findArchivedById(id: string) {
        return tx.course.findUnique({ select: { archived: true }, where: { id } });
      },

      create(data: Prisma.CourseUncheckedCreateInput) {
        return tx.course.create({ data });
      },

      update(id: string, data: Prisma.CourseUncheckedUpdateInput) {
        return tx.course.update({ where: { id }, data });
      },

      delete(id: string) {
        return tx.course.delete({ where: { id } });
      },
    };
  },
};

export const courseMembershipRepo = {
  async hasActiveStaffMembership(userId: string): Promise<boolean> {
    const count = await prisma.courseMembership.count({
      where: {
        userId,
        status: "active",
        role: { in: ["teacher", "ta"] },
        course: { archived: false },
      },
    });
    return count > 0;
  },

  countStudents(courseIds: string[]) {
    return prisma.courseMembership.count({
      where: {
        courseId: { in: courseIds },
        role: "student",
        status: "active",
      },
    });
  },

  async countStudentsByCourse(courseIds: string[]): Promise<Map<string, number>> {
    if (courseIds.length === 0) return new Map();
    const rows = await prisma.courseMembership.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        role: "student",
        status: "active",
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.courseId, r._count._all]));
  },

  countActiveAssessments(courseIds: string[], now: Date) {
    return prisma.assessment.count({
      where: {
        courseId: { in: courseIds },
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now },
      },
    });
  },

  findStudents(courseId: string) {
    return prisma.courseMembership.findMany({
      where: { courseId, role: "student", status: "active" },
      select: {
        userId: true,
        user: { select: userPublicSelect },
      },
      orderBy: { user: { username: "asc" } },
    });
  },

  listActiveStudentUserIds(courseId: string) {
    return prisma.courseMembership
      .findMany({
        where: { courseId, role: "student", status: "active" },
        select: { userId: true },
      })
      .then((rows) => rows.map((r) => r.userId));
  },

  listActiveMemberUserIds(courseId: string) {
    return prisma.courseMembership
      .findMany({
        where: { courseId, status: "active" },
        select: { userId: true },
      })
      .then((rows) => rows.map((r) => r.userId));
  },

  listActiveForUser(userId: string) {
    return prisma.courseMembership.findMany({
      where: { userId, status: "active" },
      select: { courseId: true, role: true, status: true },
    });
  },

  findByComposite(courseId: string, userId: string) {
    return prisma.courseMembership.findUnique({
      where: { courseId_userId: { courseId, userId } },
    });
  },

  withTx(tx: TxClient) {
    return {
      findByComposite(courseId: string, userId: string) {
        return tx.courseMembership.findUnique({
          where: { courseId_userId: { courseId, userId } },
        });
      },

      async listActiveMemberUserIds(courseId: string) {
        const rows = await tx.courseMembership.findMany({
          where: { courseId, status: "active" },
          select: { userId: true },
        });
        return rows.map((row) => row.userId);
      },

      create(data: Prisma.CourseMembershipUncheckedCreateInput) {
        return tx.courseMembership.create({ data });
      },

      updateById(id: string, data: Prisma.CourseMembershipUncheckedUpdateInput) {
        return tx.courseMembership.update({ where: { id }, data });
      },

      findElevatedMembership(userId: string) {
        return tx.courseMembership.findFirst({
          where: { userId, role: { in: ["teacher", "ta"] } },
          select: { id: true },
        });
      },

      upsert(
        courseId: string,
        userId: string,
        createData: Prisma.CourseMembershipUncheckedCreateInput,
        updateData: Prisma.CourseMembershipUncheckedUpdateInput,
      ) {
        return tx.courseMembership.upsert({
          create: createData,
          update: updateData,
          where: { courseId_userId: { courseId, userId } },
        });
      },
    };
  },
};
