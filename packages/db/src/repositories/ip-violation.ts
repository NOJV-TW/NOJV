import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

// IP violations are only logged on exams — standalone contests and
// homework assessments have no proctoring gates. The old repo
// accepted contestId; it now accepts examId.
export const ipViolationLogRepo = {
  create(data: Prisma.IpViolationLogUncheckedCreateInput) {
    return prisma.ipViolationLog.create({ data });
  },

  listByExam(opts: { examId: string; take: number }) {
    return prisma.ipViolationLog.findMany({
      where: { examId: opts.examId },
      include: {
        user: { select: { displayUsername: true, email: true, name: true } }
      },
      orderBy: { createdAt: "desc" },
      take: opts.take
    });
  },

  withTx(tx: TxClient) {
    return {
      create(data: Prisma.IpViolationLogUncheckedCreateInput) {
        return tx.ipViolationLog.create({ data });
      }
    };
  }
};

// Legacy contest participation IP repo is kept so standalone contests
// can still bind IPs via ContestParticipation.boundIp. Exam binding
// uses `ExamParticipation.ipPin` on a different path entirely.
export const contestParticipationIpRepo = {
  updateBoundIp(id: string, ip: string) {
    return prisma.contestParticipation.update({
      where: { id },
      data: { boundIp: ip }
    });
  },

  withTx(tx: TxClient) {
    return {
      updateBoundIp(id: string, ip: string) {
        return tx.contestParticipation.update({
          where: { id },
          data: { boundIp: ip }
        });
      }
    };
  }
};

export const examParticipationIpRepo = {
  updateIpPin(id: string, ip: string) {
    return prisma.examParticipation.update({
      where: { id },
      data: { ipPin: ip }
    });
  },

  withTx(tx: TxClient) {
    return {
      updateIpPin(id: string, ip: string) {
        return tx.examParticipation.update({
          where: { id },
          data: { ipPin: ip }
        });
      }
    };
  }
};
