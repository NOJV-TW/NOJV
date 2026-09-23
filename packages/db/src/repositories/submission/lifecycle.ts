import { prisma } from "../../client";
import type { Prisma } from "../../../generated/prisma/client";
import type { SubmissionStatus } from "../../../generated/prisma/enums";
import type { CanonicalSubmissionCreateInput, TxClient } from "./shared";
import { submissionContextColumns } from "./shared";

export const submissionLifecycle = {
  listSystemErrorsForRecovery({ limit }: { limit: number }) {
    return prisma.submission.findMany({
      where: { status: "system_error", judgeGeneration: 1 },
      select: { id: true, judgeGeneration: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  findForRejudge(where: Prisma.SubmissionWhereInput) {
    return prisma.submission.findMany({
      select: {
        id: true,
        userId: true,
        judgeGeneration: true,
        language: true,
        problemId: true,
        sampleOnly: true,
        sourceStorage: true,
      },
      where,
    });
  },

  updateStatus(id: string, status: SubmissionStatus) {
    return prisma.submission.update({
      data: { status },
      where: { id },
    });
  },

  complete(id: string, data: Prisma.SubmissionUpdateInput) {
    return prisma.submission.update({
      data,
      where: { id },
    });
  },

  completeIfInProgress(id: string, data: Prisma.SubmissionUpdateInput, updatedBefore?: Date) {
    return prisma.submission.updateMany({
      data,
      where: {
        id,
        ...(updatedBefore ? { updatedAt: { lt: updatedBefore } } : {}),
        status: {
          in: ["pending_upload", "queued", "compiling", "running"] as SubmissionStatus[],
        },
      },
    });
  },

  findStalePendingIds(before: Date) {
    return prisma.submission.findMany({
      select: { id: true },
      where: {
        status: { in: ["pending_upload", "queued", "compiling", "running"] },
        updatedAt: { lt: before },
      },
    });
  },

  withTx(tx: TxClient) {
    return {
      findById(id: string) {
        return tx.submission.findUnique({ where: { id } });
      },

      count(where: Prisma.SubmissionWhereInput) {
        return tx.submission.count({ where });
      },

      countForUserAssessmentProblemSince(
        userId: string,
        assessmentId: string,
        problemId: string,
        sinceTime: Date,
      ) {
        return tx.submission.count({
          where: {
            userId,
            assessmentId,
            problemId,
            sampleOnly: false,
            isReferenceSolution: false,
            status: { not: "system_error" },
            createdAt: { gte: sinceTime },
          },
        });
      },

      findMostRecent(where: Prisma.SubmissionWhereInput, select?: Prisma.SubmissionSelect) {
        return tx.submission.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          select: select ?? { createdAt: true },
        });
      },

      create(data: CanonicalSubmissionCreateInput) {
        const { context, ...submission } = data;
        return tx.submission.create({
          data: { ...submission, ...submissionContextColumns(context) },
        });
      },

      publishPendingUpload(id: string, sourceStorage: Prisma.InputJsonValue) {
        return tx.submission.update({
          where: { id, status: "pending_upload" },
          data: { sourceStorage, status: "queued" },
        });
      },
    };
  },
};
