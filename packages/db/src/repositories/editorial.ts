import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { userPublicSelect } from "./selects";

export const editorialRepo = {
  listByProblemId(problemId: string) {
    return prisma.editorial.findMany({
      where: { problemId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userPublicSelect } },
    });
  },

  upsert(
    userId: string,
    problemId: string,
    data: { content: string; language: Prisma.EditorialCreateInput["language"] },
  ) {
    return prisma.editorial.upsert({
      where: {
        userId_problemId_language: {
          userId,
          problemId,
          language: data.language,
        },
      },
      create: { userId, problemId, content: data.content, language: data.language },
      update: { content: data.content },
    });
  },
};
