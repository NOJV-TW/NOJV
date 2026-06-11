import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const IP_VIOLATION_RETENTION_PER_EXAM = 2000;

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

  findLastViolationAt(opts: {
    examId: string;
    userId: string;
    violationType: "whitelist" | "binding";
  }): Promise<Date | null> {
    return findLastViolationAt(prisma, opts);
  },

  withTx(tx: TxClient) {
    return {
      async create(data: Prisma.IpViolationLogUncheckedCreateInput) {
        const row = await tx.ipViolationLog.create({ data });
        await capExamViolations(tx, data.examId);
        return row;
      },
      findLastViolationAt(opts: {
        examId: string;
        userId: string;
        violationType: "whitelist" | "binding";
      }) {
        return findLastViolationAt(tx, opts);
      },
    };
  },
};

async function findLastViolationAt(
  client: typeof prisma | TxClient,
  opts: { examId: string; userId: string; violationType: "whitelist" | "binding" },
): Promise<Date | null> {
  const row = await client.ipViolationLog.findFirst({
    where: { examId: opts.examId, userId: opts.userId, violationType: opts.violationType },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
