import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, problemPreviewSelect } from "./selects";

type TxClient = TransactionClient;

export const assessmentRepo = {
  findByIdWithCourseId(id: string) {
    return prisma.courseAssessment.findUnique({
      where: { id },
      include: { course: { select: { id: true } } }
    });
  },

  findByCourseAndSlug(courseId: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      where: {
        slug: assessmentSlug,
        courseId
      },
      select: { id: true }
    });
  },

  findPublishedContext(courseId: string, assessmentSlug: string) {
    return prisma.courseAssessment.findFirst({
      select: {
        allowedLanguages: true,
        course: { select: { id: true } },
        slug: true
      },
      where: {
        courseId,
        slug: assessmentSlug,
        status: "published"
      }
    });
  },

  listByUser(userId: string) {
    return prisma.courseAssessment.findMany({
      include: {
        _count: { select: { problems: true } },
        course: { select: { id: true, title: true } }
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

  /**
   * Batched open / draft counts per course. Returns one row per course
   * that has at least one matching assessment — courses with zero fall
   * out and must be merged in as 0 by the caller.
   */
  groupOpenCountsByCourse(courseIds: string[], now: Date) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.courseAssessment.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now }
      },
      _count: { _all: true }
    });
  },

  groupDraftCountsByCourse(courseIds: string[]) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.courseAssessment.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "draft"
      },
      _count: { _all: true }
    });
  },

  /**
   * Rows the course overview needs for each recent/upcoming/open
   * assignment. Includes problem count and is scoped to a single
   * course. `includeDrafts = true` returns draft rows at the end so
   * managers can see work-in-progress; students get `false`.
   *
   * Ordering is left to the domain layer (urgency-based sort) — we
   * fetch a generous superset here and let the caller trim to `limit`.
   */
  listForCourseOverview(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        _count: { select: { problems: true } }
      },
      orderBy: { opensAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published"
      },
      // fetch a superset so the domain sort + trim still has room
      take: take * 3
    });
  },

  listUpcoming(userId: string, now: Date, take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        course: { select: { id: true, title: true } }
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
