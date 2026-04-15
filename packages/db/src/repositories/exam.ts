import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import {
  courseMiniSelect,
  problemMiniSelect,
  problemTeacherMiniSelect,
  userMiniSelect,
  userScoreboardSelect
} from "./selects";

type TxClient = TransactionClient;

const examListInclude = {
  _count: { select: { participations: true, problems: true } },
  course: { select: courseMiniSelect }
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

  // Returns a 3x superset; domain layer finalises the sort and trims to `take`.
  listForCourseOverview(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published"
      },
      take: take * 3
    });
  },

  // running/upcoming/ended status is derived from `startsAt`/`endsAt` in the domain layer.
  listForCourse(courseId: string, includeDrafts: boolean, take: number) {
    return prisma.exam.findMany({
      include: examListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        courseId,
        status: includeDrafts ? { in: ["draft", "published"] } : "published"
      },
      take
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
        course: { select: courseMiniSelect },
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

  // Includes problem `difficulty` for the teacher problems list; `findDetailById`'s mini select omits it.
  findDetailForRegistrationPage(id: string) {
    return prisma.exam.findUnique({
      include: {
        _count: { select: { participations: true } },
        course: { select: courseMiniSelect },
        problems: {
          include: {
            problem: { select: problemTeacherMiniSelect }
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
        course: { select: courseMiniSelect },
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
            user: { select: userScoreboardSelect }
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
  listForExamWithUser(examId: string) {
    return prisma.examParticipation.findMany({
      where: { examId },
      include: {
        user: { select: userMiniSelect }
      },
      orderBy: [{ status: "asc" }, { registeredAt: "asc" }]
    });
  },

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
