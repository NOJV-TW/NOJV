import { prisma } from "../client";
import type { Prisma } from "../../generated/prisma/client";
import { userPublicSelect } from "./selects";

export const editorialRepo = {
  listByProblemId(problemId: string) {
    return prisma.editorial.findMany({
      where: { problemId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userPublicSelect } },
    });
  },

  listByProblemIdPaged(problemId: string, skip: number, take: number) {
    return prisma.editorial.findMany({
      where: { problemId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { user: { select: userPublicSelect } },
      skip,
      take,
    });
  },

  countByProblemId(problemId: string) {
    return prisma.editorial.count({
      where: { problemId, deletedAt: null },
    });
  },

  async existsForUserProblem(userId: string, problemId: string) {
    const count = await prisma.editorial.count({
      where: { userId, problemId, deletedAt: null },
    });
    return count > 0;
  },

  findById(id: string) {
    return prisma.editorial.findUnique({
      where: { id },
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
      update: { content: data.content, deletedAt: null },
    });
  },

  update(
    id: string,
    data: { content?: string; language?: Prisma.EditorialCreateInput["language"] },
  ) {
    const update: Prisma.EditorialUpdateInput = {};
    if (data.content !== undefined) update.content = data.content;
    if (data.language !== undefined) update.language = data.language;
    return prisma.editorial.update({
      where: { id },
      data: update,
      include: { user: { select: userPublicSelect } },
    });
  },

  softDelete(id: string, now = new Date()) {
    return prisma.editorial.update({
      where: { id },
      data: { deletedAt: now },
      include: { user: { select: userPublicSelect } },
    });
  },
};
