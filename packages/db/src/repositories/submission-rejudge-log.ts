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
        oldResultJson: input.oldResultJson ?? Prisma.JsonNull
      }
    });
  },

  update(id: string, input: SubmissionRejudgeLogUpdateInput) {
    return prisma.submissionRejudgeLog.update({
      where: { id },
      data: {
        newVerdict: input.newVerdict,
        newScore: input.newScore,
        newResultJson: input.newResultJson ?? Prisma.JsonNull
      }
    });
  },

  listBySubmission(submissionId: string) {
    return prisma.submissionRejudgeLog.findMany({
      where: { submissionId },
      orderBy: { createdAt: "desc" }
    });
  }
};
