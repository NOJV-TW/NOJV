import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export const ipViolationLogRepo = {
  create(data: Prisma.IpViolationLogUncheckedCreateInput) {
    return prisma.ipViolationLog.create({ data });
  },

  listByContest(opts: { contestId: string; take: number }) {
    return prisma.ipViolationLog.findMany({
      where: { contestId: opts.contestId },
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
