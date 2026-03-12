import { prisma } from "@nojv/db";

import { NotFoundError } from "../auth";

export async function getSubmissionForUser(submissionId: string, userId: string, isAdmin: boolean) {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }
  });

  if (!submission) {
    throw new NotFoundError("Submission not found.");
  }

  if (submission.userId !== userId && !isAdmin) {
    throw new NotFoundError("Submission not found.");
  }

  return submission;
}
