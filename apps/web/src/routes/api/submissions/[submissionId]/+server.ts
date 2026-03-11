import { getSubmissionOperation } from "@nojv/db";
import { json } from "@sveltejs/kit";

import { NotFoundError } from "$lib/server/api-errors";
import { withAuth } from "$lib/server/api-handler";

export const GET = withAuth(async (event, actor) => {
  const submissionId = event.params.submissionId;
  const submission = await getSubmissionOperation(submissionId);

  if (!submission) {
    throw new NotFoundError("Submission not found.");
  }

  if (submission.userId !== actor.userId && actor.platformRole !== "admin") {
    throw new NotFoundError("Submission not found.");
  }

  return json({
    result: submission.verdictDetail,
    status: submission.status,
    submissionId: submission.id
  });
});
