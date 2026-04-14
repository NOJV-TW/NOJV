import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect } from "./selects";

type TxClient = TransactionClient;

const examListInclude = {
  _count: { select: { participations: true, problems: true } },
  course: { select: { id: true, title: true } }
} as const;

export const examRepo = {
  findById(id: string) {
    return prisma.exam.findUnique({ where: { id } });
  },

  findByIdOrThrow(id: string, select?: Prisma.ExamSelect) {
    return prisma.exam.findUniqueOrThrow({
      ...(select ? { select } : {}),
      where: { id }
    });
  },

  findByIdWithCourse(id: string) {
    return prisma.exam.findUnique({
      where: { id },
      select: { course: { select: { id: true } }, courseId: true, id: true }
    });
  },

  listByCourseId(courseId: string) {
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: "published"
      }
    });
  },

  listManagedForUser(userId: string, managedCourseIds: string[]) {
    const orClauses: Prisma.ExamWhereInput[] = [{ createdByUserId: userId }];
    if (managedCourseIds.length > 0) orClauses.push({ courseId: { in: managedCourseIds } });
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { updatedAt: "desc" },
      where: { OR: orClauses }
    });
  },

  /**
   * Batched count of published exams that have not yet ended, grouped
   * by course. Feeds the /courses listing card status bar ("N upcoming
   * exam" / "N exam").
   */
  groupUpcomingCountsByCourse(courseIds: string[], now: Date) {
    if (courseIds.length === 0)
      return Promise.resolve([] as { courseId: string; _count: { _all: number } }[]);
    return prisma.exam.groupBy({
      by: ["courseId"],
      where: {
        courseId: { in: courseIds },
        status: "published",
        endsAt: { gte: now }
      },
      _count: { _all: true }
    });
  },

  findDetailById(id: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: { id: true, title: true } },
        problems: {
          include: {
            problem: { select: problemMiniSelect }
          },
          orderBy: { ordinal: "asc" }
        }
      },
      where: { id }
    });
  },

  findWorkspaceById(examId: string, userId: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: { id: true, title: true } },
        participations: {
          where: { userId },
          take: 1
        },
        problems: {
          include: {
            problem: { select: problemMiniSelect }
          },
          orderBy: { ordinal: "asc" }
        }
      },
      where: { id: examId }
    });
  },

  findForScoreboard(examId: string) {
    return prisma.exam.findUnique({
      include: {
        problems: {
          include: { problem: { select: problemMiniSelect } },
          orderBy: { ordinal: "asc" }
        },
        participations: {
          include: {
            user: { select: { displayUsername: true, username: true, name: true } }
          },
          where: { status: { in: ["active", "submitted"] } }
        }
      },
      where: { id: examId }
    });
  },

  findInfoById(id: string) {
    return prisma.exam.findUniqueOrThrow({
      select: {
        endsAt: true,
        frozenAt: true,
        scoringMode: true,
        startsAt: true
      },
      where: { id }
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
          some: { userId, status: "active" }
        }
      },
      select: {
        id: true,
        course: { select: { id: true } }
      }
    });
  },

  findParticipation(examId: string, userId: string) {
    return prisma.examParticipation.findUnique({
      select: { id: true, ipPin: true },
      where: {
        examId_userId: { examId, userId }
      }
    });
  },

  count() {
    return prisma.exam.count();
  },

  update(id: string, data: Prisma.ExamUpdateInput) {
    return prisma.exam.update({
      data,
      where: { id }
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.exam.findUnique({ where: { id } });
      },

      create(data: Prisma.ExamUncheckedCreateInput) {
        return tx.exam.create({ data });
      },

      update(id: string, data: Prisma.ExamUncheckedUpdateInput) {
        return tx.exam.update({
          data,
          where: { id }
        });
      }
    };
  }
};

export const examProblemRepo = {
  findByExamId(examId: string) {
    return prisma.examProblem.findMany({
      where: { examId },
      include: { problem: { select: problemMiniSelect } },
      orderBy: { ordinal: "asc" }
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ExamProblemUncheckedCreateInput) {
        return tx.examProblem.create({ data });
      },

      deleteByExamId(examId: string) {
        return tx.examProblem.deleteMany({
          where: { examId }
        });
      }
    };
  }
};

export const examParticipationRepo = {
  findByIdWithExam(id: string) {
    return prisma.examParticipation.findUnique({
      include: {
        exam: {
          include: {
            problems: { orderBy: { ordinal: "asc" } }
          }
        }
      },
      where: { id }
    });
  },

  update(id: string, data: Prisma.ExamParticipationUpdateInput) {
    return prisma.examParticipation.update({
      data,
      where: { id }
    });
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        examId: string,
        userId: string,
        createData: Prisma.ExamParticipationUncheckedCreateInput,
        updateData: Prisma.ExamParticipationUncheckedUpdateInput
      ) {
        return tx.examParticipation.upsert({
          create: createData,
          update: updateData,
          where: {
            examId_userId: { examId, userId }
          }
        });
      },

      findByExamAndUser(examId: string, userId: string) {
        return tx.examParticipation.findUnique({
          where: { examId_userId: { examId, userId } }
        });
      }
    };
  }
};
