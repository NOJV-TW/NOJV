import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, problemPreviewSelect } from "./selects";

type TxClient = TransactionClient;

export const assessmentRepo = {
  findByIdWithCourseSlug(id: string) {
    return prisma.courseAssessment.findUnique({
      where: { id },
      include: { course: { select: { slug: true } } }
    });
  },

  findByCourseAndSlug(courseSlug: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      where: {
        slug: assessmentSlug,
        course: { slug: courseSlug }
      },
      select: { id: true }
    });
  },

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
