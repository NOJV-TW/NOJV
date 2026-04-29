import { prisma } from "../client";
import type { PlagiarismContext } from "../../generated/prisma/enums";

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

  upsert(input: {
    contextType: PlagiarismContext;
    contextId: string;
    pairKey: string;
    flaggedBy: string;
    note: string | null;
  }) {
    return prisma.plagiarismPairFlag.upsert({
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

  deleteById(id: string) {
    return prisma.plagiarismPairFlag.delete({ where: { id } });
  },
};
