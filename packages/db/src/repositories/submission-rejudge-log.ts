import { prisma } from "../client";
import { Prisma } from "../../generated/prisma/client";

export interface SubmissionRejudgeLogCreateInput {
  submissionId: string;
  rejudgedByUserId: string | null;
  oldVerdict: string;
  oldScore: number;
  oldResultJson: Prisma.InputJsonValue | null;
}

export interface SubmissionRejudgeLogUpdateInput {
  newVerdict: string;
  newScore: number;
  newResultJson: Prisma.InputJsonValue | null;
}

export const submissionRejudgeLogRepo = {
  create(input: SubmissionRejudgeLogCreateInput) {
    return prisma.submissionRejudgeLog.create({
      data: {
        submissionId: input.submissionId,
        rejudgedByUserId: input.rejudgedByUserId,
        oldVerdict: input.oldVerdict,
        oldScore: input.oldScore,
        oldResultJson: input.oldResultJson ?? Prisma.JsonNull,
      },
    });
  },

  update(id: string, input: SubmissionRejudgeLogUpdateInput) {
    return prisma.submissionRejudgeLog.update({
      where: { id },
      data: {
        newVerdict: input.newVerdict,
        newScore: input.newScore,
        newResultJson: input.newResultJson ?? Prisma.JsonNull,
      },
    });
  },

  listBySubmission(submissionId: string) {
    return prisma.submissionRejudgeLog.findMany({
      where: { submissionId },
      orderBy: { createdAt: "desc" },
    });
  },

  listForSubmissionIds(submissionIds: string[]) {
    if (submissionIds.length === 0) return Promise.resolve([]);
    return prisma.submissionRejudgeLog.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { createdAt: "desc" },
    });
  },

  listPaged(opts: {
    limit: number;
    cursor?: string;
    problemId?: string;
    rejudgedByUserId?: string;
  }) {
    const where: Prisma.SubmissionRejudgeLogWhereInput = {};
    if (opts.problemId) where.submission = { problemId: opts.problemId };
    if (opts.rejudgedByUserId) where.rejudgedByUserId = opts.rejudgedByUserId;

    return prisma.submissionRejudgeLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        oldVerdict: true,
        oldScore: true,
        newVerdict: true,
        newScore: true,
        submissionId: true,
        submission: { select: { problemId: true, userId: true } },
        rejudgedBy: { select: { id: true, username: true } },
      },
    });
  },
};
