import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, userMiniSelect, userScoreboardSelect } from "./selects";

type TxClient = TransactionClient;

/**
 * Thrown by `contestParticipationRepo.updateWithVersion` when the row's
 * `version` column has moved on since the caller read it (Prisma surfaces
 * this as P2025). The domain layer catches this and retries on a fresh read.
 */
export class ParticipationVersionConflict extends Error {
  readonly participationId: string;
  readonly expectedVersion: number;

  constructor(participationId: string, expectedVersion: number) {
    super(
      `ContestParticipation ${participationId} version ${String(expectedVersion)} no longer current.`,
    );
    this.name = "ParticipationVersionConflict";
    this.participationId = participationId;
    this.expectedVersion = expectedVersion;
  }
}

const contestListInclude = {
  _count: { select: { participations: true, problems: true } },
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
      include: contestListInclude,
      orderBy: { startsAt: "desc" },
      where: { visibility: "published" },
    });
  },

  // Standalone contests only; course-role teaching rights live on `Exam`.
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
        _count: { select: { participations: true } },
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

  findWorkspaceById(id: string, userId: string) {
    return prisma.contest.findUnique({
      include: {
        _count: { select: { participations: true } },
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
        participations: {
          include: {
            user: { select: userScoreboardSelect },
          },
          where: { status: { in: ["active", "submitted"] } },
        },
      },
      where: { id },
    });
  },

  findForChartById(id: string, userIds: string[]) {
    return prisma.contest.findUnique({
      select: {
        startsAt: true,
        participations: {
          where: { userId: { in: userIds } },
          select: { id: true, userId: true },
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
            participations: { some: { userId } },
          },
        },
        select: { id: true },
      })
      .then((row) => row !== null);
  },

  // Currently-active contests that include this problem and that the user
  // is participating in. Used by the editorial context resolver to deny
  // editorial reads while the live event is still running.
  findActiveContestsForUser(problemId: string, userId: string, now: Date) {
    return prisma.contestProblem.findMany({
      where: {
        problemId,
        contest: {
          visibility: "published",
          endsAt: { gt: now },
          participations: { some: { userId } },
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

      deleteByContestId(contestId: string) {
        return tx.contestProblem.deleteMany({
          where: { contestId },
        });
      },
    };
  },
};

export const contestParticipationRepo = {
  findByIdWithContest(id: string) {
    return prisma.contestParticipation.findUnique({
      include: {
        contest: {
          include: {
            problems: { orderBy: { ordinal: "asc" } },
          },
        },
      },
      where: { id },
    });
  },

  // Lightweight id-only list used by notification fan-out workflows.
  listParticipantUserIds(contestId: string) {
    return prisma.contestParticipation
      .findMany({ where: { contestId }, select: { userId: true } })
      .then((rows) => rows.map((r) => r.userId));
  },

  // Participant roster with user mini profiles — used by the score-override
  // drawer so staff can pick a student to adjust.
  listParticipantsWithUser(contestId: string) {
    return prisma.contestParticipation.findMany({
      where: { contestId },
      include: { user: { select: userMiniSelect } },
      orderBy: [{ user: { username: "asc" } }],
    });
  },

  update(id: string, data: Prisma.ContestParticipationUpdateInput) {
    return prisma.contestParticipation.update({
      data,
      where: { id },
    });
  },

  /**
   * Optimistic-lock update: only writes when the current row's `version`
   * still matches `expectedVersion`, and bumps it by one in the same
   * statement. If another writer raced ahead, Prisma's `update` raises
   * P2025 (record not found) — we translate that to `ParticipationVersionConflict`
   * so callers can retry on a fresh read.
   */
  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.ContestParticipationUpdateInput,
  ) {
    try {
      return await prisma.contestParticipation.update({
        data: { ...data, version: { increment: 1 } },
        where: { id, version: expectedVersion },
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2025") {
        throw new ParticipationVersionConflict(id, expectedVersion);
      }
      throw err;
    }
  },

  // Id-only lookup — used by score-override invalidation so we can call
  // `updateContestScores(participationId)` after editing an override.
  findIdByContestAndUser(contestId: string, userId: string) {
    return prisma.contestParticipation
      .findUnique({
        where: { contestId_userId: { contestId, userId } },
        select: { id: true },
      })
      .then((row) => row?.id ?? null);
  },

  withTx(tx: TxClient) {
    return {
      upsert(
        contestId: string,
        userId: string,
        createData: Prisma.ContestParticipationUncheckedCreateInput,
        updateData: Prisma.ContestParticipationUncheckedUpdateInput,
      ) {
        return tx.contestParticipation.upsert({
          create: createData,
          update: updateData,
          where: {
            contestId_userId: { contestId, userId },
          },
        });
      },

      findByContestAndUser(contestId: string, userId: string) {
        return tx.contestParticipation.findUnique({
          where: { contestId_userId: { contestId, userId } },
        });
      },
    };
  },
};
