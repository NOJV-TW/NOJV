import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import {
  courseMiniSelect,
  problemMiniSelect,
  problemTeacherMiniSelect,
  userMiniSelect,
  userScoreboardSelect,
} from "./selects";

type TxClient = TransactionClient;

export class ExamParticipationVersionConflict extends Error {
  readonly participationId: string;
  readonly expectedVersion: number;

  constructor(participationId: string, expectedVersion: number) {
    super(
      `ExamParticipation ${participationId} version ${String(expectedVersion)} no longer current.`,
    );
    this.name = "ExamParticipationVersionConflict";
    this.participationId = participationId;
    this.expectedVersion = expectedVersion;
  }
}

const examListInclude = {
  _count: { select: { participations: true, problems: true } },
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
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
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

  findDetailById(id: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: true } },
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
        _count: { select: { participations: true } },
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

  findWorkspaceById(examId: string, userId: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: courseMiniSelect },
        participations: {
          where: { userId },
          take: 1,
        },
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
        participations: {
          include: {
            user: { select: userScoreboardSelect },
          },
          where: { status: { in: ["active", "submitted"] } },
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
          some: { userId, status: "active" },
        },
      },
      select: {
        id: true,
        course: { select: { id: true } },
      },
    });
  },

  findParticipation(examId: string, userId: string) {
    return prisma.examParticipation.findUnique({
      select: { id: true, ipPin: true },
      where: {
        examId_userId: { examId, userId },
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

  sumPointsByExam(examIds: string[]) {
    if (examIds.length === 0) return Promise.resolve([]);
    return prisma.examProblem.groupBy({
      by: ["examId"],
      _sum: { points: true },
      where: { examId: { in: examIds } },
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
            participations: { some: { userId } },
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

      deleteByExamId(examId: string) {
        return tx.examProblem.deleteMany({
          where: { examId },
        });
      },
    };
  },
};

export const examParticipationRepo = {
  listForExamWithUser(examId: string) {
    return prisma.examParticipation.findMany({
      where: { examId },
      include: {
        user: { select: userMiniSelect },
      },
      orderBy: [{ status: "asc" }, { registeredAt: "asc" }],
    });
  },

  listParticipantUserIds(examId: string) {
    return prisma.examParticipation
      .findMany({ where: { examId }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId));
  },

  findByIdWithExam(id: string) {
    return prisma.examParticipation.findUnique({
      include: {
        exam: {
          include: {
            problems: { orderBy: { ordinal: "asc" } },
          },
        },
      },
      where: { id },
    });
  },

  update(id: string, data: Prisma.ExamParticipationUpdateInput) {
    return prisma.examParticipation.update({
      data,
      where: { id },
    });
  },

  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.ExamParticipationUpdateInput,
  ) {
    try {
      return await prisma.examParticipation.update({
        data: { ...data, version: { increment: 1 } },
        where: { id, version: expectedVersion },
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2025") {
        throw new ExamParticipationVersionConflict(id, expectedVersion);
      }
      throw err;
    }
  },

  findIdByExamAndUser(examId: string, userId: string) {
    return prisma.examParticipation
      .findUnique({
        where: { examId_userId: { examId, userId } },
        select: { id: true },
      })
      .then((row) => row?.id ?? null);
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        examId: string,
        userId: string,
        createData: Prisma.ExamParticipationUncheckedCreateInput,
        updateData: Prisma.ExamParticipationUncheckedUpdateInput,
      ) {
        return tx.examParticipation.upsert({
          create: createData,
          update: updateData,
          where: {
            examId_userId: { examId, userId },
          },
        });
      },

      findByExamAndUser(examId: string, userId: string) {
        return tx.examParticipation.findUnique({
          where: { examId_userId: { examId, userId } },
        });
      },

      findIpPinByExamAndUser(examId: string, userId: string) {
        return tx.examParticipation.findUnique({
          select: { id: true, ipPin: true, ipGateExemptUntil: true },
          where: { examId_userId: { examId, userId } },
        });
      },
    };
  },
};
