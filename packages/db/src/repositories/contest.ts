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

  findBySlug(slug: string) {
    return prisma.contest.findUnique({ where: { slug } });
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
      select: { slug: true, visibility: true }
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

  findDetailBySlug(slug: string) {
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
      where: { slug }
    });
  },

  findWorkspaceBySlug(slug: string, userId: string) {
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
      where: { slug }
    });
  },

  findForScoreboard(slug: string) {
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
      where: { slug }
    });
  },

  findForChart(slug: string, userIds: string[]) {
    return prisma.contest.findUnique({
      select: {
        startsAt: true,
        participations: {
          where: { userId: { in: userIds } },
          select: { id: true, userId: true }
        }
      },
      where: { slug }
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

  findParticipation(contestId: string, userId: string) {
    return prisma.contestParticipation.findUnique({
      select: { id: true, boundIp: true },
      where: {
        contestId_userId: { contestId, userId }
      }
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
      findBySlug(slug: string) {
        return tx.contest.findUnique({ where: { slug } });
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
  existsBySlug(contestSlug: string, problemId: string) {
    return prisma.contestProblem
      .findFirst({
        where: { contest: { slug: contestSlug }, problemId },
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
