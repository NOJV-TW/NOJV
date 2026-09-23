import { prisma } from "../client";
import type { Prisma, SupportedLanguage } from "../../generated/prisma/client";

export interface CodeDraftRowKey {
  userId: string;
  contextKey: string;
  problemId: string;
}

export const codeDraftRepo = {
  listForProblem(scope: CodeDraftRowKey) {
    return prisma.codeDraft.findMany({
      where: scope,
      select: { language: true, sourceCode: true, sourceFiles: true, updatedAt: true },
    });
  },

  save(
    scope: CodeDraftRowKey & { language: SupportedLanguage },
    source: { sourceCode: string } | { sourceFiles: Prisma.InputJsonValue },
  ) {
    return prisma.codeDraft.upsert({
      where: { userId_contextKey_problemId_language: scope },
      create: { ...scope, ...source },
      update: source,
      select: { updatedAt: true },
    });
  },
};
