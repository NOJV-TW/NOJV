import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";

export const editorialRepo = {
  /** List editorials for a problem with author info. */
  listByProblemId(problemId: string) {
    return prisma.editorial.findMany({
      where: { problemId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true, name: true } } }
    });
  },

  /** Upsert an editorial for a (user, problem, language) triple. A
   * user may post multiple editorials for the same problem as long as
   * they are in different languages. */
  upsert(
    userId: string,
    problemId: string,
    data: { content: string; language: Prisma.EditorialCreateInput["language"] }
  ) {
    return prisma.editorial.upsert({
      where: {
        userId_problemId_language: {
          userId,
          problemId,
          language: data.language
        }
      },
      create: { userId, problemId, content: data.content, language: data.language },
      update: { content: data.content }
    });
  }
};
