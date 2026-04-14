import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

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
            memberships: { where: { status: "active" } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      ...(userId
        ? {
            where: {
              memberships: {
                some: { userId, status: "active" }
              }
            }
          }
        : {})
    });
  },

  findByIdWithUserMembership(id: string, userId: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        memberships: {
          where: { userId },
          take: 1
        }
      }
    });
  },

  findByIdWithHeader(id: string, userId: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        memberships: {
          where: { userId },
          take: 1
        },
        _count: {
          select: {
            memberships: { where: { role: "student", status: "active" } },
            assessments: { where: { status: "published" } },
            exams: { where: { status: "published" } }
          }
        }
      }
    });
  },

  /**
   * Batched fetch for the /courses listing page. Pulls every course the
   * given IDs point at, with owner display name + a per-course `_count`
   * block covering the counters the course card needs.
   */
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
            exams: { where: { status: "published" } }
          }
        }
      }
    });
  },

  count() {
    return prisma.course.count();
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.course.findUnique({ where: { id } });
      },

      create(data: Prisma.CourseUncheckedCreateInput) {
        return tx.course.create({ data });
      },

      update(id: string, data: Prisma.CourseUncheckedUpdateInput) {
        return tx.course.update({ where: { id }, data });
      },

      delete(id: string) {
        return tx.course.delete({ where: { id } });
      }
    };
  }
};

export const courseMembershipRepo = {
  countStudents(courseIds: string[]) {
    return prisma.courseMembership.count({
      where: {
        courseId: { in: courseIds },
        role: "student",
        status: "active"
      }
    });
  },

  countActiveAssessments(courseIds: string[], now: Date) {
    return prisma.courseAssessment.count({
      where: {
        courseId: { in: courseIds },
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now }
      }
    });
  },

  findStudents(courseId: string) {
    return prisma.courseMembership.findMany({
      where: { courseId, role: "student", status: "active" },
      select: {
        userId: true,
        user: { select: { username: true, name: true } }
      },
      orderBy: { user: { username: "asc" } }
    });
  },

  listActiveForUser(userId: string) {
    return prisma.courseMembership.findMany({
      where: { userId, status: "active" },
      select: { courseId: true, role: true, status: true }
    });
  },

  withTx(tx: TxClient) {
    return {
      findByComposite(courseId: string, userId: string) {
        return tx.courseMembership.findUnique({
          where: { courseId_userId: { courseId, userId } }
        });
      },

      create(data: Prisma.CourseMembershipUncheckedCreateInput) {
        return tx.courseMembership.create({ data });
      },

      upsert(
        courseId: string,
        userId: string,
        createData: Prisma.CourseMembershipUncheckedCreateInput,
        updateData: Prisma.CourseMembershipUncheckedUpdateInput
      ) {
        return tx.courseMembership.upsert({
          create: createData,
          update: updateData,
          where: { courseId_userId: { courseId, userId } }
        });
      }
    };
  }
};
