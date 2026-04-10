import { prisma } from "../client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

/**
 * One row per user per calendar day (UTC). Powers streak counters,
 * heatmaps, and range queries without touching the Submission table.
 *
 * The write path is always an upsert because the row may or may not
 * already exist for today — callers should pass the caller-truncated
 * day (date-only, midnight UTC).
 */
export const userDailyActivityRepo = {
  /** Upsert the activity row for (userId, date), incrementing counters. */
  increment(opts: { userId: string; date: Date; isAc: boolean }) {
    const acDelta = opts.isAc ? 1 : 0;
    return prisma.userDailyActivity.upsert({
      where: { userId_date: { userId: opts.userId, date: opts.date } },
      create: {
        userId: opts.userId,
        date: opts.date,
        submissionCount: 1,
        acCount: acDelta
      },
      update: {
        submissionCount: { increment: 1 },
        acCount: { increment: acDelta }
      }
    });
  },

  /** Find activity rows for a user over a date range (heatmap/streak). */
  findRange(userId: string, from: Date, to: Date) {
    return prisma.userDailyActivity.findMany({
      where: {
        userId,
        date: { gte: from, lte: to }
      },
      orderBy: { date: "desc" }
    });
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
            acCount: acDelta
          },
          update: {
            submissionCount: { increment: 1 },
            acCount: { increment: acDelta }
          }
        });
      }
    };
  }
};
