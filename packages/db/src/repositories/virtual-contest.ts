import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { mirrorParticipation } from "./participation-mirror";

type TxClient = TransactionClient;

function virtualMirrorSource(row: {
  userId: string;
  contestId: string;
  score: number;
  penaltySeconds: number;
  subtaskScores: Prisma.JsonValue;
  status: string;
  startedAt: Date;
  endsAt: Date;
}) {
  return {
    type: "virtual" as const,
    userId: row.userId,
    contestId: row.contestId,
    score: row.score,
    penaltySeconds: row.penaltySeconds,
    subtaskScores: row.subtaskScores as Prisma.InputJsonValue | null,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: null,
    typeData: { endsAt: row.endsAt.toISOString() },
  };
}

export class VirtualContestVersionConflict extends Error {
  readonly virtualContestId: string;
  readonly expectedVersion: number;

  constructor(virtualContestId: string, expectedVersion: number) {
    super(
      `VirtualContest ${virtualContestId} version ${String(expectedVersion)} no longer current.`,
    );
    this.name = "VirtualContestVersionConflict";
    this.virtualContestId = virtualContestId;
    this.expectedVersion = expectedVersion;
  }
}

export const virtualContestRepo = {
  findById(id: string) {
    return prisma.virtualContest.findUnique({ where: { id } });
  },

  findByContestAndUser(contestId: string, userId: string) {
    return prisma.virtualContest.findUnique({
      where: { contestId_userId: { contestId, userId } },
    });
  },

  async create(data: Prisma.VirtualContestUncheckedCreateInput) {
    const row = await prisma.virtualContest.create({ data });
    await mirrorParticipation(prisma, virtualMirrorSource(row));
    return row;
  },

  update(id: string, data: Prisma.VirtualContestUpdateInput) {
    return prisma.virtualContest.update({
      data,
      where: { id },
    });
  },

  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.VirtualContestUpdateInput,
  ) {
    try {
      return await prisma.virtualContest.update({
        data: { ...data, version: { increment: 1 } },
        where: { id, version: expectedVersion },
      });
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code === "P2025") {
        throw new VirtualContestVersionConflict(id, expectedVersion);
      }
      throw err;
    }
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.virtualContest.findUnique({ where: { id } });
      },

      findByContestAndUser(contestId: string, userId: string) {
        return tx.virtualContest.findUnique({
          where: { contestId_userId: { contestId, userId } },
        });
      },

      async create(data: Prisma.VirtualContestUncheckedCreateInput) {
        const row = await tx.virtualContest.create({ data });
        await mirrorParticipation(tx, virtualMirrorSource(row));
        return row;
      },

      update(id: string, data: Prisma.VirtualContestUncheckedUpdateInput) {
        return tx.virtualContest.update({
          data,
          where: { id },
        });
      },
    };
  },
};
