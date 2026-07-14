import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import {
  courseMiniSelect,
  problemMiniSelect,
  problemPreviewSelect,
  problemTeacherMiniSelect,
} from "./selects";

type TxClient = TransactionClient;

export const assessmentRepo = {
  findByIdWithCourseId(id: string) {
    return prisma.assessment.findUnique({
      where: { id },
      include: { course: { select: { id: true } } },
    });
  },

  findByCourseAndId(courseId: string, assessmentId: string) {
    return prisma.assessment.findFirst({
      where: {
        id: assessmentId,
        courseId,
      },
      select: { id: true },
    });
  },

  findPublishedContextById(courseId: string, assessmentId: string) {
    return prisma.assessment.findFirst({
      select: {
        id: true,
        allowedLanguages: true,
        course: { select: { id: true, ownerId: true, archived: true } },
        opensAt: true,
        closesAt: true,
      },
      where: {
        courseId,
        id: assessmentId,
        status: "published",
      },
    });
  },

  listByUser(userId: string) {
    return prisma.assessment.findMany({
      omit: { plagiarismResults: true },
      include: {
        _count: { select: { problems: true } },
        course: { select: courseMiniSelect },
      },
      orderBy: { opensAt: "desc" },
      where: {
        course: {
          memberships: {
            some: { userId, status: "active" },
          },
        },
        status: "published",
      },
    });
  },

  groupOpenCountsByCourse(courseIds: string[], now: Date) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.assessment.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "published",
        opensAt: { lte: now },
        closesAt: { gte: now },
      },
      _count: { _all: true },
    });
  },

  groupDraftCountsByCourse(courseIds: string[]) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.assessment.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "draft",
      },
      _count: { _all: true },
    });
  },

  listNeedingTimers(now: Date) {
    return prisma.assessment.findMany({
      select: {
        id: true,
        opensAt: true,
        closesAt: true,
        scheduleRevision: true,
        timerFingerprint: true,
      },
      where: { status: "published", closesAt: { gt: now } },
    });
  },

  listForCourseOverview(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.assessment.findMany({
      include: {
        _count: { select: { problems: true } },
      },
      orderBy: { opensAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published",
      },
      take: take * 3,
    });
  },

  listForCourse(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.assessment.findMany({
      include: {
        _count: { select: { problems: true } },
      },
      orderBy: { opensAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published",
      },
      take,
    });
  },

  listAcrossCourses(allCourseIds: string[], managerCourseIds: string[], take: number) {
    return prisma.assessment.findMany({
      omit: { plagiarismResults: true },
      include: {
        _count: { select: { problems: true } },
        course: { select: courseMiniSelect },
      },
      orderBy: { opensAt: "desc" },
      where: {
        OR: [
          { courseId: { in: allCourseIds }, status: "published" },
          { courseId: { in: managerCourseIds }, status: "draft" },
        ],
      },
      take,
    });
  },

  listUpcoming(userId: string, now: Date, take: number) {
    return prisma.assessment.findMany({
      omit: { plagiarismResults: true },
      include: {
        course: { select: courseMiniSelect },
      },
      orderBy: { opensAt: "asc" },
      where: {
        course: {
          memberships: {
            some: { userId, status: "active" },
          },
        },
        closesAt: { gte: now },
        status: "published",
      },
      take,
    });
  },

  findWithProblemsById(courseId: string, assessmentId: string) {
    return prisma.assessment.findFirst({
      where: { courseId, id: assessmentId, status: "published" },
      select: {
        id: true,
        problems: {
          select: {
            problemId: true,
            problem: { select: problemPreviewSelect },
          },
          orderBy: { ordinal: "asc" },
        },
      },
    });
  },

  findInfoById(id: string) {
    return prisma.assessment.findUniqueOrThrow({
      select: {
        closesAt: true,
        dueAt: true,
        opensAt: true,
      },
      where: { id },
    });
  },

  listPublishedWithProblemsByCourse(courseId: string) {
    return prisma.assessment.findMany({
      where: { courseId, status: "published" },
      orderBy: { opensAt: "asc" },
      select: {
        id: true,
        title: true,
        opensAt: true,
        problems: {
          orderBy: { ordinal: "asc" },
          select: {
            points: true,
            problem: { select: problemMiniSelect },
          },
        },
      },
    });
  },

  findDetailById(courseId: string, assessmentId: string) {
    return prisma.assessment.findFirst({
      where: { id: assessmentId, courseId },
      select: {
        id: true,
        courseId: true,
        title: true,
        summary: true,
        status: true,
        opensAt: true,
        dueAt: true,
        closesAt: true,
        maxAttemptsPerDay: true,
        attemptResetMinuteOfDay: true,
        allowedLanguages: true,
        adjustmentRules: true,
        problems: {
          orderBy: { ordinal: "asc" },
          select: {
            ordinal: true,
            points: true,
            problem: { select: problemTeacherMiniSelect },
          },
        },
      },
    });
  },

  count() {
    return prisma.assessment.count();
  },

  async copyPreviewByCourseId(courseId: string) {
    const rows = await prisma.assessment.findMany({
      where: { courseId },
      select: { status: true, _count: { select: { problems: true } } },
    });
    let problemLinks = 0;
    const byStatus = { draft: 0, published: 0, archived: 0 };
    for (const r of rows) {
      byStatus[r.status as keyof typeof byStatus] += 1;
      problemLinks += r._count.problems;
    }
    return { total: rows.length, byStatus, problemLinks };
  },

  update(id: string, data: Prisma.AssessmentUpdateInput) {
    return prisma.assessment.update({
      data,
      where: { id },
    });
  },

  delete(id: string) {
    return prisma.assessment.delete({ where: { id } });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.assessment.findUnique({ where: { id } });
      },

      lockForUpdate(assessmentId: string) {
        return tx.$queryRaw`SELECT id FROM "Assessment" WHERE id = ${assessmentId} FOR UPDATE`;
      },

      findByCompositeId(courseId: string, assessmentId: string) {
        return tx.assessment.findFirst({
          where: { id: assessmentId, courseId },
        });
      },

      async listByCourseIdAllWithProblems(courseId: string) {
        await tx.$queryRaw`SELECT id FROM "Assessment" WHERE "courseId" = ${courseId} FOR UPDATE`;
        return tx.assessment.findMany({
          where: { courseId },
          orderBy: { opensAt: "asc" },
          include: {
            problems: {
              select: { problemId: true, ordinal: true, points: true },
              orderBy: { ordinal: "asc" },
            },
          },
        });
      },

      create(data: Prisma.AssessmentUncheckedCreateInput) {
        return tx.assessment.create({ data });
      },

      update(id: string, data: Prisma.AssessmentUncheckedUpdateInput) {
        return tx.assessment.update({
          data,
          where: { id },
        });
      },

      delete(id: string) {
        return tx.assessment.delete({ where: { id } });
      },
    };
  },
};

export const assessmentProblemRepo = {
  findByAssessmentId(assessmentId: string) {
    return prisma.assessmentProblem.findMany({
      where: { assessmentId },
      include: { problem: { select: problemMiniSelect } },
    });
  },

  exists(assessmentId: string, problemId: string) {
    return prisma.assessmentProblem
      .findFirst({ where: { assessmentId, problemId }, select: { id: true } })
      .then((row) => row !== null);
  },

  listProblemLinks(assessmentIds: string[]) {
    if (assessmentIds.length === 0)
      return Promise.resolve([] as { assessmentId: string; problemId: string }[]);
    return prisma.assessmentProblem.findMany({
      where: { assessmentId: { in: assessmentIds } },
      select: { assessmentId: true, problemId: true },
    });
  },

  hasEndedAssessmentForUser(problemId: string, userId: string, now: Date) {
    return prisma.assessmentProblem
      .findFirst({
        where: {
          problemId,
          assessment: {
            status: "published",
            closesAt: { lt: now },
            course: {
              memberships: { some: { userId, status: "active" } },
            },
          },
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  findActiveAssessmentsForUser(problemId: string, userId: string, now: Date) {
    return prisma.assessmentProblem.findMany({
      where: {
        problemId,
        assessment: {
          status: "published",
          closesAt: { gt: now },
          course: {
            memberships: { some: { userId, status: "active" } },
          },
        },
      },
      select: {
        assessment: { select: { id: true, closesAt: true } },
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.AssessmentProblemUncheckedCreateInput) {
        return tx.assessmentProblem.create({ data });
      },

      findLink(assessmentId: string, problemId: string) {
        return tx.assessmentProblem.findFirst({
          where: { assessmentId, problemId },
          select: { id: true },
        });
      },

      deleteByAssessmentId(assessmentId: string) {
        return tx.assessmentProblem.deleteMany({
          where: { assessmentId },
        });
      },
    };
  },
};
