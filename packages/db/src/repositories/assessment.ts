import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, problemPreviewSelect } from "./selects";

type TxClient = TransactionClient;

export const assessmentRepo = {
  /** Find assessment by ID with course slug (plagiarism). */
  findByIdWithCourseSlug(id: string) {
    return prisma.courseAssessment.findUnique({
      where: { id },
      include: { course: { select: { slug: true } } }
    });
  },

  /** Find assessment by course slug + assessment slug (used in submission filtering). */
  findByCourseAndSlug(courseSlug: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      where: {
        slug: assessmentSlug,
        course: { slug: courseSlug }
      },
      select: { id: true }
    });
  },

  /** Find published assessment context for workspace. */
  findPublishedContext(courseSlug: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      select: {
        allowedLanguages: true,
        course: { select: { slug: true } },
        slug: true
      },
      where: {
        course: { slug: courseSlug },
        slug: assessmentSlug,
        status: "published"
      }
    });
  },

  /** List user's assessments from enrolled courses. */
  listByUser(userId: string) {
    return prisma.courseAssessment.findMany({
      include: {
        _count: { select: { problems: true } },
        course: { select: { slug: true, title: true } }
      },
      orderBy: { opensAt: "desc" },
      where: {
        course: {
          memberships: {
            some: { userId, status: "active" }
          }
        },
        status: "published"
      }
    });
  },

  /** List upcoming assessments for a user. */
  listUpcoming(userId: string, now: Date, take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        course: { select: { slug: true, title: true } }
      },
      orderBy: { opensAt: "asc" },
      where: {
        course: {
          memberships: {
            some: { userId, status: "active" }
          }
        },
        closesAt: { gte: now },
        status: "published"
      },
      take
    });
  },

  /** Find assessment with problems for progress matrix. */
  findWithProblems(courseId: string, slug: string) {
    return prisma.courseAssessment.findFirst({
      where: { courseId, slug, status: "published" },
      select: {
        id: true,
        problems: {
          select: {
            problemId: true,
            problem: { select: problemPreviewSelect }
          },
          orderBy: { ordinal: "asc" }
        }
      }
    });
  },

  /** Find active page-locked assessment for a user. */
  findPageLockedForUser(userId: string, now: Date) {
    return prisma.courseAssessment.findFirst({
      where: {
        pageLockEnabled: true,
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now },
        course: {
          memberships: {
            some: { userId, status: "active" }
          }
        }
      },
      select: {
        slug: true,
        course: { select: { slug: true } }
      }
    });
  },

  /** Fetch assessment info for temporal activities. */
  findInfoById(id: string) {
    return prisma.courseAssessment.findUniqueOrThrow({
      select: {
        closesAt: true,
        dueAt: true,
        opensAt: true
      },
      where: { id }
    });
  },

  /** List published assessments for a course with problem counts (manage page). */
  listByCourseSlug(courseSlug: string) {
    return prisma.courseAssessment.findMany({
      where: {
        course: { slug: courseSlug },
        status: "published"
      },
      orderBy: { opensAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        opensAt: true,
        dueAt: true,
        closesAt: true,
        _count: { select: { problems: true } }
      }
    });
  },

  /** Find assessment with problems and problem details (export/plagiarism). */
  findWithProblemDetails(courseId: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      where: { courseId, slug: assessmentSlug, status: "published" },
      select: {
        id: true,
        problems: {
          select: {
            problemId: true,
            problem: { select: problemPreviewSelect }
          },
          orderBy: { ordinal: "asc" }
        }
      }
    });
  },

  count() {
    return prisma.courseAssessment.count();
  },

  update(id: string, data: Prisma.CourseAssessmentUpdateInput) {
    return prisma.courseAssessment.update({
      data,
      where: { id }
    });
  },

  // ── Transaction variants ──

  withTx(tx: TxClient) {
    return {
      findByComposite(courseId: string, slug: string) {
        return tx.courseAssessment.findUnique({
          where: { courseId_slug: { courseId, slug } }
        });
      },

      create(data: Prisma.CourseAssessmentUncheckedCreateInput) {
        return tx.courseAssessment.create({ data });
      }
    };
  }
};

export const assessmentProblemRepo = {
  /** Find assessment problems with problem details (plagiarism page). */
  findByAssessmentId(assessmentId: string) {
    return prisma.courseAssessmentProblem.findMany({
      where: { assessmentId },
      include: { problem: { select: problemMiniSelect } }
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.CourseAssessmentProblemUncheckedCreateInput) {
        return tx.courseAssessmentProblem.create({ data });
      }
    };
  }
};

export const assessmentParticipationRepo = {
  upsert(userId: string, assessmentId: string) {
    return prisma.assessmentParticipation.upsert({
      where: {
        userId_assessmentId: { userId, assessmentId }
      },
      create: { userId, assessmentId },
      update: {},
      select: { id: true, boundIp: true }
    });
  },

  updateBoundIp(id: string, ip: string) {
    return prisma.assessmentParticipation.update({
      where: { id },
      data: { boundIp: ip, boundAt: new Date() }
    });
  },

  withTx(tx: TxClient) {
    return {
      upsert(userId: string, assessmentId: string) {
        return tx.assessmentParticipation.upsert({
          where: {
            userId_assessmentId: { userId, assessmentId }
          },
          create: { userId, assessmentId },
          update: {},
          select: { id: true, boundIp: true }
        });
      }
    };
  }
};
