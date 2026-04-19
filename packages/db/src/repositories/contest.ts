import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, userScoreboardSelect } from "./selects";

type TxClient = TransactionClient;

const contestListInclude = {
  _count: { select: { participations: true, problems: true } }
} as const;

export const contestRepo = {
  findById(id: string) {
    return prisma.contest.findUnique({ where: { id } });
  },

  findByIdOrThrow(id: string, select?: Prisma.ContestSelect) {
    return prisma.contest.findUniqueOrThrow({
      ...(select ? { select } : {}),
      where: { id }
    });
  },

  findByInviteCode(inviteCode: string) {
    return prisma.contest.findUnique({
      where: { inviteCode },
      select: { id: true, visibility: true }
    });
  },

  listPublished() {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: { visibility: "published" }
    });
  },

  // Standalone contests only; course-role teaching rights live on `Exam`.
  listManagedForUser(userId: string) {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { updatedAt: "desc" },
      where: { createdByUserId: userId }
    });
  },

  listParticipable() {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: { visibility: "published" }
    });
  },

  findDetailById(id: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: true } },
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

  findWorkspaceById(id: string, userId: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: true } },
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
      where: { id }
    });
  },

  findForScoreboardById(id: string) {
    return prisma.contest.findUnique({
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
      where: { id }
    });
  },

  findForChartById(id: string, userIds: string[]) {
    return prisma.contest.findUnique({
      select: {
        startsAt: true,
        participations: {
          where: { userId: { in: userIds } },
          select: { id: true, userId: true }
        }
      },
      where: { id }
    });
  },

  findInfoById(id: string) {
    return prisma.contest.findUniqueOrThrow({
      select: {
        endsAt: true,
        frozenAt: true,
        scoringMode: true,
        startsAt: true
      },
      where: { id }
    });
  },

  count() {
    return prisma.contest.count();
  },

  update(id: string, data: Prisma.ContestUpdateInput) {
    return prisma.contest.update({
      data,
      where: { id }
    });
  },

  healthCheck() {
    return prisma.$queryRaw`SELECT 1`;
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.contest.findUnique({ where: { id } });
      },

      create(data: Prisma.ContestUncheckedCreateInput) {
        return tx.contest.create({ data });
      },

      update(id: string, data: Prisma.ContestUncheckedUpdateInput) {
        return tx.contest.update({
          data,
          where: { id }
        });
      }
    };
  }
};

export const contestProblemRepo = {
  existsById(contestId: string, problemId: string) {
    return prisma.contestProblem
      .findFirst({
        where: { contestId, problemId },
        select: { id: true }
      })
      .then((row) => row !== null);
  },

  // Practice-after-close: a user who participated in a published contest
  // that has since ended retains read/submit access to the contest's
  // problems — for practice only, no scoring.
  hasEndedContestForUser(problemId: string, userId: string, now: Date) {
    return prisma.contestProblem
      .findFirst({
        where: {
          problemId,
          contest: {
            visibility: "published",
            endsAt: { lt: now },
            participations: { some: { userId } }
          }
        },
        select: { id: true }
      })
      .then((row) => row !== null);
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ContestProblemUncheckedCreateInput) {
        return tx.contestProblem.create({ data });
      },

      deleteByContestId(contestId: string) {
        return tx.contestProblem.deleteMany({
          where: { contestId }
        });
      }
    };
  }
};

export const contestParticipationRepo = {
  findByIdWithContest(id: string) {
    return prisma.contestParticipation.findUnique({
      include: {
        contest: {
          include: {
            problems: { orderBy: { ordinal: "asc" } }
          }
        }
      },
      where: { id }
    });
  },

  // Lightweight id-only list used by notification fan-out workflows.
  listParticipantUserIds(contestId: string) {
    return prisma.contestParticipation
      .findMany({ where: { contestId }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId));
  },

  update(id: string, data: Prisma.ContestParticipationUpdateInput) {
    return prisma.contestParticipation.update({
      data,
      where: { id }
    });
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        contestId: string,
        userId: string,
        createData: Prisma.ContestParticipationUncheckedCreateInput,
        updateData: Prisma.ContestParticipationUncheckedUpdateInput
      ) {
        return tx.contestParticipation.upsert({
          create: createData,
          update: updateData,
          where: {
            contestId_userId: { contestId, userId }
          }
        });
      },

      findByContestAndUser(contestId: string, userId: string) {
        return tx.contestParticipation.findUnique({
          where: { contestId_userId: { contestId, userId } }
        });
      }
    };
  }
};
