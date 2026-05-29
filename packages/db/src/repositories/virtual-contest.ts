import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

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

  create(data: Prisma.VirtualContestUncheckedCreateInput) {
    return prisma.virtualContest.create({ data });
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

      create(data: Prisma.VirtualContestUncheckedCreateInput) {
        return tx.virtualContest.create({ data });
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
