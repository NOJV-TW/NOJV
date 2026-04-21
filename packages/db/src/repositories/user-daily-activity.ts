import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * Callers must pass a truncated day (date-only, midnight UTC) so the
 * upsert composite key always lands on the same row per calendar day.
 */
export const userDailyActivityRepo = {
  increment(opts: { userId: string; date: Date; isAc: boolean }) {
    const acDelta = opts.isAc ? 1 : 0;
    return prisma.userDailyActivity.upsert({
      where: { userId_date: { userId: opts.userId, date: opts.date } },
      create: {
        userId: opts.userId,
        date: opts.date,
        submissionCount: 1,
        acCount: acDelta,
      },
      update: {
        submissionCount: { increment: 1 },
        acCount: { increment: acDelta },
      },
    });
  },

  findRange(userId: string, from: Date, to: Date) {
    return prisma.userDailyActivity.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
      },
      orderBy: { date: "desc" },
    });
  },

  // Decrement is clamped at 0 via `acCount >= -delta` — repeated flips cannot drive it negative.
  async adjustAcCount(opts: { userId: string; date: Date; delta: number }) {
    if (opts.delta === 0) return;
    if (opts.delta > 0) {
      await prisma.userDailyActivity.updateMany({
        where: { userId: opts.userId, date: opts.date },
        data: { acCount: { increment: opts.delta } },
      });
    } else {
      await prisma.userDailyActivity.updateMany({
        where: { userId: opts.userId, date: opts.date, acCount: { gte: -opts.delta } },
        data: { acCount: { increment: opts.delta } },
      });
    }
  },

  withTx(tx: TxClient) {
    return {
      increment(opts: { userId: string; date: Date; isAc: boolean }) {
        const acDelta = opts.isAc ? 1 : 0;
        return tx.userDailyActivity.upsert({
          where: { userId_date: { userId: opts.userId, date: opts.date } },
          create: {
            userId: opts.userId,
            date: opts.date,
            submissionCount: 1,
            acCount: acDelta,
          },
          update: {
            submissionCount: { increment: 1 },
            acCount: { increment: acDelta },
          },
        });
      },
    };
  },
};
