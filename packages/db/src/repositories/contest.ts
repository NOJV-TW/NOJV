import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect } from "./selects";

type TxClient = TransactionClient;

const contestListInclude = {
  _count: { select: { participations: { where: { type: "contest" } }, problems: true } },
} as const;

export const contestRepo = {
  findById(id: string) {
    return prisma.contest.findUnique({ where: { id } });
  },

  findByIdOrThrow(id: string, select?: Prisma.ContestSelect) {
    return prisma.contest.findUniqueOrThrow({
      ...(select ? { select } : {}),
      where: { id },
    });
  },

  findByInviteCode(inviteCode: string) {
    return prisma.contest.findUnique({
      where: { inviteCode },
      select: { id: true, visibility: true },
    });
  },

  listPublished() {
    return prisma.contest.findMany({
      omit: { plagiarismResults: true },
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: { visibility: "published", inviteCode: null },
    });
  },

  listParticipatedContestsForUser(userId: string) {
    return prisma.contest.findMany({
      omit: { plagiarismResults: true },
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: {
        visibility: "published",
        participations: { some: { type: "contest", userId } },
      },
    });
  },

  listManagedForUser(userId: string) {
    return prisma.contest.findMany({
      include: contestListInclude,
      orderBy: { updatedAt: "desc" },
      where: { createdByUserId: userId },
    });
  },

  findDetailById(id: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: { where: { type: "contest" } } } },
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

  findWorkspaceById(id: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: { where: { type: "contest" } } } },
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

  findForScoreboardById(id: string) {
    return prisma.contest.findUnique({
      include: {
        problems: {
          include: { problem: { select: problemMiniSelect } },
          orderBy: { ordinal: "asc" },
        },
      },
      where: { id },
    });
  },

  findInfoById(id: string) {
    return prisma.contest.findUniqueOrThrow({
      select: {
        endsAt: true,
        frozenAt: true,
        scoringMode: true,
        startsAt: true,
      },
      where: { id },
    });
  },

  listNeedingTimers(input: { now: Date; afterId?: string; take: number }) {
    return prisma.contest.findMany({
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        frozenAt: true,
        scoreboardMode: true,
        scheduleRevision: true,
        timerFingerprint: true,
      },
      orderBy: { id: "asc" },
      take: input.take,
      where: {
        visibility: "published",
        ...(input.afterId ? { id: { gt: input.afterId } } : {}),
        OR: [{ endsAt: { gt: input.now } }, { frozenBoard: true }],
      },
    });
  },

  count() {
    return prisma.contest.count();
  },

  update(id: string, data: Prisma.ContestUpdateInput) {
    return prisma.contest.update({
      data,
      where: { id },
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

      lockForUpdate(contestId: string) {
        return tx.$queryRaw`SELECT id FROM "Contest" WHERE id = ${contestId} FOR UPDATE`;
      },

      create(data: Prisma.ContestUncheckedCreateInput) {
        return tx.contest.create({ data });
      },

      update(id: string, data: Prisma.ContestUncheckedUpdateInput) {
        return tx.contest.update({
          data,
          where: { id },
        });
      },

      delete(id: string) {
        return tx.contest.delete({ where: { id } });
      },
    };
  },
};

export const contestProblemRepo = {
  existsById(contestId: string, problemId: string) {
    return prisma.contestProblem
      .findFirst({
        where: { contestId, problemId },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  hasEndedContestForUser(problemId: string, userId: string, now: Date) {
    return prisma.contestProblem
      .findFirst({
        where: {
          problemId,
          contest: {
            visibility: "published",
            endsAt: { lt: now },
            participations: { some: { type: "contest", userId } },
          },
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  findActiveContestsForUser(problemId: string, _userId: string, now: Date) {
    return prisma.contestProblem.findMany({
      where: {
        problemId,
        contest: {
          visibility: "published",
          endsAt: { gt: now },
          startsAt: { lte: now },
        },
      },
      select: {
        contest: { select: { id: true, endsAt: true } },
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.ContestProblemUncheckedCreateInput) {
        return tx.contestProblem.create({ data });
      },

      countByContestId(contestId: string) {
        return tx.contestProblem.count({ where: { contestId } });
      },

      findLink(contestId: string, problemId: string) {
        return tx.contestProblem.findFirst({
          where: { contestId, problemId },
          select: { id: true },
        });
      },

      deleteByContestId(contestId: string) {
        return tx.contestProblem.deleteMany({
          where: { contestId },
        });
      },
    };
  },
};
