import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { courseMiniSelect, problemMiniSelect, problemTeacherMiniSelect } from "./selects";

type TxClient = TransactionClient;

const examListInclude = {
  _count: { select: { participations: { where: { type: "exam" } }, problems: true } },
  course: { select: courseMiniSelect },
} as const;

export const examRepo = {
  findById(id: string) {
    return prisma.exam.findUnique({ where: { id } });
  },

  findByIdOrThrow(id: string, select?: Prisma.ExamSelect) {
    return prisma.exam.findUniqueOrThrow({
      ...(select ? { select } : {}),
      where: { id },
    });
  },

  findByIdWithCourse(id: string) {
    return prisma.exam.findUnique({
      where: { id },
      select: { course: { select: { id: true } }, courseId: true, id: true },
    });
  },

  listByCourseId(courseId: string) {
    return prisma.exam.findMany({
      omit: { plagiarismResults: true },
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: "published",
      },
    });
  },

  listByCourseIds(courseIds: string[]) {
    return prisma.exam.findMany({
      omit: { plagiarismResults: true },
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId: { in: courseIds },
        status: "published",
      },
    });
  },

  listForCourseOverview(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published",
      },
      take: take * 3,
    });
  },

  listForCourse(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published",
      },
      take,
    });
  },

  listManagedForUser(userId: string, managedCourseIds: string[]) {
    const orClauses: Prisma.ExamWhereInput[] = [{ createdByUserId: userId }];
    if (managedCourseIds.length > 0) orClauses.push({ courseId: { in: managedCourseIds } });
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { updatedAt: "desc" },
      where: { OR: orClauses },
    });
  },

  groupUpcomingCountsByCourse(courseIds: string[], now: Date) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.exam.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "published",
        endsAt: { gte: now },
      },
      _count: { _all: true },
    });
  },

  listNeedingTimers(now: Date) {
    return prisma.exam.findMany({
      select: { id: true, startsAt: true, endsAt: true },
      where: { status: "published", endsAt: { gt: now } },
    });
  },

  findDetailById(id: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: { where: { type: "exam" } } } },
        course: { select: courseMiniSelect },
        problems: {
          include: {
            problem: { select: problemMiniSelect },
          },
          orderBy: { ordinal: "asc" },
        },
      },
      where: { id },
    });
  },

  findDetailForRegistrationPage(id: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: { where: { type: "exam" } } } },
        course: { select: { id: true, title: true, archived: true } },
        problems: {
          include: {
            problem: { select: problemTeacherMiniSelect },
          },
          orderBy: { ordinal: "asc" },
        },
      },
      where: { id },
    });
  },

  findWorkspaceById(examId: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: { where: { type: "exam" } } } },
        course: { select: courseMiniSelect },
        problems: {
          include: {
            problem: { select: problemMiniSelect },
          },
          orderBy: { ordinal: "asc" },
        },
      },
      where: { id: examId },
    });
  },

  findForScoreboard(examId: string) {
    return prisma.exam.findUnique({
      include: {
        problems: {
          include: { problem: { select: problemMiniSelect } },
          orderBy: { ordinal: "asc" },
        },
      },
      where: { id: examId },
    });
  },

  findInfoById(id: string) {
    return prisma.exam.findUniqueOrThrow({
      select: {
        endsAt: true,
        scoringMode: true,
        startsAt: true,
      },
      where: { id },
    });
  },

  findPageLockedForUser(userId: string, now: Date) {
    return prisma.exam.findFirst({
      where: {
        pageLockEnabled: true,
        status: "published",
        startsAt: { lte: now },
        endsAt: { gte: now },
        participations: {
          some: { type: "exam", userId, status: "active" },
        },
      },
      select: {
        id: true,
        course: { select: { id: true } },
      },
    });
  },

  count() {
    return prisma.exam.count();
  },

  async copyPreviewByCourseId(courseId: string) {
    const rows = await prisma.exam.findMany({
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

  update(id: string, data: Prisma.ExamUpdateInput) {
    return prisma.exam.update({
      data,
      where: { id },
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.exam.findUnique({ where: { id } });
      },

      listByCourseIdAllWithProblems(courseId: string) {
        return tx.exam.findMany({
          where: { courseId },
          orderBy: { startsAt: "asc" },
          include: {
            problems: {
              select: { problemId: true, ordinal: true, points: true },
              orderBy: { ordinal: "asc" },
            },
          },
        });
      },

      create(data: Prisma.ExamUncheckedCreateInput) {
        return tx.exam.create({ data });
      },

      update(id: string, data: Prisma.ExamUncheckedUpdateInput) {
        return tx.exam.update({
          data,
          where: { id },
        });
      },

      delete(id: string) {
        return tx.exam.delete({ where: { id } });
      },
    };
  },
};

export const examProblemRepo = {
  findByExamId(examId: string) {
    return prisma.examProblem.findMany({
      where: { examId },
      include: { problem: { select: problemMiniSelect } },
      orderBy: { ordinal: "asc" },
    });
  },

  countByExamId(examId: string) {
    return prisma.examProblem.count({ where: { examId } });
  },

  exists(examId: string, problemId: string) {
    return prisma.examProblem
      .findFirst({ where: { examId, problemId }, select: { id: true } })
      .then((row) => row !== null);
  },

  listProblemLinks(examIds: string[]) {
    if (examIds.length === 0)
      return Promise.resolve([] as { examId: string; problemId: string }[]);
    return prisma.examProblem.findMany({
      where: { examId: { in: examIds } },
      select: { examId: true, problemId: true },
    });
  },

  hasEndedExamForUser(problemId: string, userId: string, now: Date) {
    return prisma.examProblem
      .findFirst({
        where: {
          problemId,
          exam: {
            status: "published",
            endsAt: { lt: now },
            participations: { some: { type: "exam", userId } },
          },
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  findActiveExamsForUser(problemId: string, userId: string, now: Date) {
    return prisma.examProblem.findMany({
      where: {
        problemId,
        exam: {
          status: "published",
          endsAt: { gt: now },
          startsAt: { lte: now },
          course: {
            memberships: { some: { userId, status: "active" } },
          },
        },
      },
      select: {
        exam: { select: { id: true, endsAt: true } },
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ExamProblemUncheckedCreateInput) {
        return tx.examProblem.create({ data });
      },

      countByExamId(examId: string) {
        return tx.examProblem.count({ where: { examId } });
      },

      exists(examId: string, problemId: string) {
        return tx.examProblem
          .findFirst({ where: { examId, problemId }, select: { id: true } })
          .then((row) => row !== null);
      },

      deleteByExamId(examId: string) {
        return tx.examProblem.deleteMany({
          where: { examId },
        });
      },
    };
  },
};
