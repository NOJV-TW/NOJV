import { prisma } from "../client";
import type { TransactionClient } from "../transaction";
import { userPublicSelect } from "./selects";

export const postCommentRepo = {
  listByPostId(postId: string) {
    return prisma.postComment.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: userPublicSelect } },
    });
  },

  findById(id: string) {
    return prisma.postComment.findUnique({ where: { id } });
  },

  create(data: { postId: string; authorId: string; parentId: string | null; content: string }) {
    return prisma.postComment.create({ data });
  },

  softDelete(id: string, now = new Date()) {
    return prisma.postComment.update({
      where: { id },
      data: { deletedAt: now },
    });
  },

  async softDeleteIfActive(id: string, now = new Date()) {
    const result = await prisma.postComment.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: now },
    });
    return result.count;
  },

  withTx(tx: TransactionClient) {
    return {
      async softDeleteIfActive(id: string, now = new Date()) {
        const result = await tx.postComment.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: now },
        });
        return result.count;
      },
    };
  },
};
