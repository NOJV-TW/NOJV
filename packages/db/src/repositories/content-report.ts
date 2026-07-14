import { prisma } from "../client";
import type { ContentReportStatus } from "../../generated/prisma/client";
import type { TransactionClient } from "../transaction";
import { problemMiniSelect, userPublicSelect } from "./selects";

const reportPostSelect = {
  id: true,
  type: true,
  title: true,
  problemId: true,
  authorId: true,
  deletedAt: true,
  author: { select: userPublicSelect },
  problem: { select: problemMiniSelect },
} as const;

const reportCommentSelect = {
  id: true,
  content: true,
  postId: true,
  authorId: true,
  deletedAt: true,
  author: { select: userPublicSelect },
  post: {
    select: {
      id: true,
      type: true,
      title: true,
      problemId: true,
      problem: { select: problemMiniSelect },
    },
  },
} as const;

export const contentReportRepo = {
  create(data: {
    postId?: string;
    commentId?: string;
    reportedByUserId: string;
    reason: string;
  }) {
    return prisma.contentReport.create({ data });
  },

  listByStatus(status: ContentReportStatus) {
    return prisma.contentReport.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        post: { select: reportPostSelect },
        comment: { select: reportCommentSelect },
        reportedBy: { select: userPublicSelect },
      },
    });
  },

  findById(id: string) {
    return prisma.contentReport.findUnique({
      where: { id },
      include: {
        post: { select: reportPostSelect },
        comment: { select: reportCommentSelect },
      },
    });
  },

  updateStatus(
    id: string,
    data: { status: ContentReportStatus; resolvedByUserId: string; resolvedAt: Date },
  ) {
    return prisma.contentReport.update({ where: { id }, data });
  },

  withTx(tx: TransactionClient) {
    return {
      updateStatusIfOpen(
        id: string,
        data: { status: ContentReportStatus; resolvedByUserId: string; resolvedAt: Date },
      ) {
        return tx.contentReport.update({ where: { id, status: "open" }, data });
      },
    };
  },
};
