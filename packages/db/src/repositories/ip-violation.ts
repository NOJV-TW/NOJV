import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

// Per-exam cap on retained violation rows. A noisy proctored exam can
// otherwise accumulate logs without bound — `listByExam` only ever reads
// the most recent few hundred. Mirrors `NOTIFICATION_RETENTION_PER_USER`.
export const IP_VIOLATION_RETENTION_PER_EXAM = 2000;

// Prune everything past the retention window for one exam, oldest first.
async function capExamViolations(tx: TxClient, examId: string): Promise<void> {
  await tx.$executeRaw`
    DELETE FROM "IpViolationLog"
    WHERE "id" IN (
      SELECT "id" FROM "IpViolationLog"
      WHERE "examId" = ${examId}
      ORDER BY "createdAt" DESC
      OFFSET ${IP_VIOLATION_RETENTION_PER_EXAM}
    )
  `;
}

// Only exams carry proctoring; every `IpViolationLog` row is tied to an exam.
// Contests are public CP events with no IP gating, by product design.
export const ipViolationLogRepo = {
  create(data: Prisma.IpViolationLogUncheckedCreateInput) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.ipViolationLog.create({ data });
      await capExamViolations(tx, data.examId);
      return row;
    });
  },

  listByExam(opts: { examId: string; take: number }) {
    return prisma.ipViolationLog.findMany({
      where: { examId: opts.examId },
      include: {
        user: { select: { displayUsername: true, email: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: opts.take,
    });
  },

  withTx(tx: TxClient) {
    return {
      async create(data: Prisma.IpViolationLogUncheckedCreateInput) {
        const row = await tx.ipViolationLog.create({ data });
        await capExamViolations(tx, data.examId);
        return row;
      },
    };
  },
};

export const examParticipationIpRepo = {
  withTx(tx: TxClient) {
    return {
      updateIpPin(id: string, ip: string) {
        return tx.examParticipation.update({
          where: { id },
          data: { ipPin: ip },
        });
      },
    };
  },
};
