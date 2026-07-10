import { prisma } from "../client";
import type { Prisma, ProblemPostType } from "../../generated/prisma/client";
import { userPublicSelect } from "./selects";

export const postRepo = {
  listByProblemIdPaged(problemId: string, type: ProblemPostType, skip: number, take: number) {
    return prisma.problemPost.findMany({
      where: { problemId, type, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: userPublicSelect },
        votes: { select: { userId: true, value: true } },
        _count: { select: { comments: { where: { deletedAt: null } } } },
      },
      skip,
      take,
    });
  },

  countByProblemId(problemId: string, type: ProblemPostType) {
    return prisma.problemPost.count({
      where: { problemId, type, deletedAt: null },
    });
  },

  async existsForUserProblem(userId: string, problemId: string) {
    const count = await prisma.problemPost.count({
      where: { authorId: userId, problemId, type: "editorial", deletedAt: null },
    });
    return count > 0;
  },

  findById(id: string) {
    return prisma.problemPost.findUnique({
      where: { id },
      include: {
        author: { select: userPublicSelect },
        votes: { select: { userId: true, value: true } },
      },
    });
  },

  create(data: {
    type: ProblemPostType;
    authorId: string;
    problemId: string;
    title: string;
    content: string;
  }) {
    return prisma.problemPost.create({ data });
  },

  update(id: string, data: { title?: string; content?: string }) {
    const update: Prisma.ProblemPostUpdateInput = {};
    if (data.title !== undefined) update.title = data.title;
    if (data.content !== undefined) update.content = data.content;
    return prisma.problemPost.update({
      where: { id },
      data: update,
      include: { author: { select: userPublicSelect } },
    });
  },

  softDelete(id: string, now = new Date()) {
    return prisma.problemPost.update({
      where: { id },
      data: { deletedAt: now },
      include: { author: { select: userPublicSelect } },
    });
  },

  async softDeleteIfActive(id: string, now = new Date()) {
    const result = await prisma.problemPost.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: now },
    });
    return result.count;
  },
};
