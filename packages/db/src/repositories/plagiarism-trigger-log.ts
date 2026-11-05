import { prisma } from "../client";
import type { PlagiarismContext } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export interface PlagiarismTriggerLogCreateData {
  id?: string;
  contextType: PlagiarismContext;
  contextId: string;
  triggeredByUserId: string | null;
  priorPairCount: number;
}

export const plagiarismTriggerLogRepo = {
  create(tx: TxClient, data: PlagiarismTriggerLogCreateData) {
    return tx.plagiarismTriggerLog.create({ data });
  },

  findById(tx: TxClient, id: string) {
    return tx.plagiarismTriggerLog.findUnique({ where: { id }, select: { id: true } });
  },

  listForContext(contextType: PlagiarismContext, contextId: string, limit = 50) {
    return prisma.plagiarismTriggerLog.findMany({
      where: { contextType, contextId },
      orderBy: { triggeredAt: "desc" },
      take: limit,
      include: {
        triggeredBy: { select: { id: true, username: true, name: true } },
      },
    });
  },
};
