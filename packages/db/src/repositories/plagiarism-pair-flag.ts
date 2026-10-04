import { prisma } from "../client";
import type { PlagiarismContext } from "../../generated/prisma/enums";
import type { TransactionClient } from "../transaction";

export type { PlagiarismContext };

export interface PlagiarismPairFlagRow {
  id: string;
  contextType: PlagiarismContext;
  contextId: string;
  pairKey: string;
  flaggedBy: string;
  flaggedAt: Date;
  note: string | null;
}

export const plagiarismPairFlagRepo = {
  listByContext(contextType: PlagiarismContext, contextId: string) {
    return prisma.plagiarismPairFlag.findMany({
      where: { contextType, contextId },
      orderBy: { flaggedAt: "desc" },
    });
  },

  findById(id: string) {
    return prisma.plagiarismPairFlag.findUnique({ where: { id } });
  },

  upsert(
    tx: TransactionClient,
    input: {
      contextType: PlagiarismContext;
      contextId: string;
      pairKey: string;
      flaggedBy: string;
      note: string | null;
    },
  ) {
    return tx.plagiarismPairFlag.upsert({
      where: {
        contextType_contextId_pairKey: {
          contextType: input.contextType,
          contextId: input.contextId,
          pairKey: input.pairKey,
        },
      },
      update: {
        flaggedBy: input.flaggedBy,
        note: input.note,
        flaggedAt: new Date(),
      },
      create: {
        contextType: input.contextType,
        contextId: input.contextId,
        pairKey: input.pairKey,
        flaggedBy: input.flaggedBy,
        note: input.note,
      },
    });
  },

  deleteById(tx: TransactionClient, id: string) {
    return tx.plagiarismPairFlag.delete({ where: { id } });
  },
};
