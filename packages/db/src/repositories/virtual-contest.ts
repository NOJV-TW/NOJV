import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * Thrown by `virtualContestRepo.updateWithVersion` when the row's
 * `version` column has moved on since the caller read it (Prisma surfaces
 * this as P2025). The domain layer catches this and retries on a fresh read.
 * Mirrors `ParticipationVersionConflict` in `./contest`.
 */
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

  /**
   * Optimistic-lock update: only writes when the current row's `version`
   * still matches `expectedVersion`, and bumps it by one in the same
   * statement. If another writer raced ahead, Prisma's `update` raises
   * P2025 (record not found) — we translate that to `VirtualContestVersionConflict`
   * so callers can retry on a fresh read. Mirrors
   * `contestParticipationRepo.updateWithVersion`.
   */
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
