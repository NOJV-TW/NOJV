import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import {
  courseMiniSelect,
  problemMiniSelect,
  problemPreviewSelect,
  problemTeacherMiniSelect
} from "./selects";

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
        id: true,
        allowedLanguages: true,
        course: { select: { id: true, ownerId: true, archived: true } },
        slug: true,
        opensAt: true,
        closesAt: true
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
        course: { select: courseMiniSelect }
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

  // Courses with zero rows fall out of the result set — callers must merge them in as 0.
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

  // Returns a 3x superset; the domain layer applies urgency-based sort and trims to `take`.
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
      take: take * 3
    });
  },

  // open/upcoming/closed status is derived from `opensAt`/`closesAt` in the domain layer, not stored columns.
  listForCourse(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        _count: { select: { problems: true } }
      },
      orderBy: { opensAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published"
      },
      take
    });
  },

  // Early return on empty arrays would collapse the inferred include-payload type at the call site.
  listAcrossCourses(allCourseIds: string[], managerCourseIds: string[], take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        _count: { select: { problems: true } },
        course: { select: courseMiniSelect }
      },
      orderBy: { opensAt: "desc" },
      where: {
        OR: [
          { courseId: { in: allCourseIds }, status: "published" },
          { courseId: { in: managerCourseIds }, status: "draft" }
        ]
      },
      take
    });
  },

  listUpcoming(userId: string, now: Date, take: number) {
    return prisma.courseAssessment.findMany({
      include: {
        course: { select: courseMiniSelect }
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

  findDetailById(courseId: string, assessmentId: string) {
    return prisma.courseAssessment.findFirst({
      where: { id: assessmentId, courseId },
      select: {
        id: true,
        courseId: true,
        slug: true,
        title: true,
        summary: true,
        status: true,
        opensAt: true,
        dueAt: true,
        closesAt: true,
        maxAttemptsPerDay: true,
        allowedLanguages: true,
        problems: {
          orderBy: { ordinal: "asc" },
          select: {
            ordinal: true,
            points: true,
            problem: { select: problemTeacherMiniSelect }
          }
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

  exists(assessmentId: string, problemId: string) {
    return prisma.courseAssessmentProblem
      .findFirst({ where: { assessmentId, problemId }, select: { id: true } })
      .then((row) => row !== null);
  },

  // Practice-after-close: a user who had an active membership in a course
  // whose published assessment closed in the past and contained this
  // problem retains read/submit access — for practice only, no scoring.
  hasEndedAssessmentForUser(problemId: string, userId: string, now: Date) {
    return prisma.courseAssessmentProblem
      .findFirst({
        where: {
          problemId,
          assessment: {
            status: "published",
            closesAt: { lt: now },
            course: {
              memberships: { some: { userId, status: "active" } }
            }
          }
        },
        select: { id: true }
      })
      .then((row) => row !== null);
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.CourseAssessmentProblemUncheckedCreateInput) {
        return tx.courseAssessmentProblem.create({ data });
      }
    };
  }
};
