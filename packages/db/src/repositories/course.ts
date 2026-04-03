import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { CourseJoinMethod } from "../../generated/prisma/enums";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const courseRepo = {
  findBySlug(slug: string) {
    return prisma.course.findUnique({ where: { slug } });
  },

  findIdBySlug(slug: string) {
    return prisma.course.findUnique({
      where: { slug },
      select: { id: true }
    });
  },

  /** List course cards with assessment/member counts. */
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

  /** Fetch full course page data with assessments, members, problems. */
  findDetailBySlug(slug: string) {
    return prisma.course.findUnique({
      include: {
        assessments: {
          include: {
            problems: {
              include: { problem: true },
              orderBy: { ordinal: "asc" }
            }
          },
          orderBy: { opensAt: "asc" }
        },
        joinTokens: { orderBy: { createdAt: "asc" } },
        memberships: {
          include: { user: true },
          orderBy: { createdAt: "asc" },
          where: { status: "active" }
        },
        problems: {
          include: {
            problem: {
              include: {
                author: { select: { username: true } },
                statements: true
              }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      },
      where: { slug }
    });
  },

  /** Find course by slug with a specific user's membership (for permission resolution). */
  findBySlugWithUserMembership(slug: string, userId: string) {
    return prisma.course.findUnique({
      where: { slug },
      include: {
        memberships: {
          where: { userId },
          take: 1
        }
      }
    });
  },

  count() {
    return prisma.course.count();
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findBySlug(slug: string) {
        return tx.course.findUnique({ where: { slug } });
      },

      create(data: Prisma.CourseUncheckedCreateInput) {
        return tx.course.create({ data });
      }
    };
  }
};

export const courseMembershipRepo = {
  /** Count active students across multiple courses (teacher overview). */
  countStudents(courseSlugs: string[]) {
    return prisma.courseMembership.count({
      where: {
        course: { slug: { in: courseSlugs } },
        role: "student",
        status: "active"
      }
    });
  },

  /** Count active assessments across multiple courses (teacher overview). */
  countActiveAssessments(courseSlugs: string[], now: Date) {
    return prisma.courseAssessment.count({
      where: {
        course: { slug: { in: courseSlugs } },
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now }
      }
    });
  },

  /** Find active student memberships for a course. */
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

export const courseJoinTokenRepo = {
  withTx(tx: TxClient) {
    return {
      findByToken(courseId: string, method: CourseJoinMethod, token: string) {
        return tx.courseJoinToken.findFirst({
          where: { courseId, method, token }
        });
      },

      create(data: Prisma.CourseJoinTokenUncheckedCreateInput) {
        return tx.courseJoinToken.create({ data });
      },

      incrementUsage(id: string) {
        return tx.courseJoinToken.update({
          data: { usageCount: { increment: 1 } },
          where: { id }
        });
      }
    };
  }
};

export const courseProblemRepo = {
  /** Find course problems with statements (for progress matrix). */
  findByCourseId(courseId: string) {
    return prisma.courseProblem.findMany({
      where: { courseId },
      select: {
        problem: { select: { id: true, slug: true, summary: true, statements: true } }
      },
      orderBy: { createdAt: "asc" }
    });
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        courseId: string,
        problemId: string,
        createData: Prisma.CourseProblemUncheckedCreateInput,
        updateData: Prisma.CourseProblemUncheckedUpdateInput
      ) {
        return tx.courseProblem.upsert({
          create: createData,
          update: updateData,
          where: { courseId_problemId: { courseId, problemId } }
        });
      }
    };
  }
};
