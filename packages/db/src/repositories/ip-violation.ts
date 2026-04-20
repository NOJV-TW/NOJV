import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

// Only exams carry proctoring; every `IpViolationLog` row is tied to an exam.
// Contests are public CP events with no IP gating, by product design.
export const ipViolationLogRepo = {
  create(data: Prisma.IpViolationLogUncheckedCreateInput) {
    return prisma.ipViolationLog.create({ data });
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
      create(data: Prisma.IpViolationLogUncheckedCreateInput) {
        return tx.ipViolationLog.create({ data });
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
