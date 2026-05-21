import { prisma } from "../client";
import type { PlagiarismContext } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";

type TxClient = TransactionClient;

export interface PlagiarismTriggerLogCreateData {
  contextType: PlagiarismContext;
  contextId: string;
  triggeredByUserId: string | null;
  priorPairCount: number;
}

export const plagiarismTriggerLogRepo = {
  create(tx: TxClient, data: PlagiarismTriggerLogCreateData) {
    return tx.plagiarismTriggerLog.create({ data });
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
