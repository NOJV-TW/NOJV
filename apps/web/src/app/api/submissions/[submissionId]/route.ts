import { getSubmissionOperation } from "@nojv/db";
import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/server/api-errors";
import { withAuthParams } from "@/lib/server/api-handler";

export const GET = withAuthParams<{ submissionId: string }>(
  async (_request, actor, { submissionId }) => {
    const submission = await getSubmissionOperation(submissionId);

    if (!submission) {
      throw new NotFoundError("Submission not found.");
    }

    if (submission.userId !== actor.userId && actor.platformRole !== "admin") {
      throw new NotFoundError("Submission not found.");
    }

    return NextResponse.json({
      result: submission.verdictDetail,
      status: submission.status,
      submissionId: submission.id
    });
  }
);
