import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { NotFoundError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

// POST /api/submissions/[id]/rejudges — create a single rejudge for one
// submission. `rejudges` is the plural sub-resource; the POST returns 202
// with the Temporal workflow id so the client can correlate progress.
export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await submissionDomain.getSubmissionById(id);
  if (!submission) throw new NotFoundError("Submission not found.");

  await submissionDomain.assertCanOperateOnSubmission(actor, submission);
  const { workflowId } = await submissionDomain.dispatchRejudge({
    mode: "single",
    submissionId: submission.id,
    triggeredByUserId: actor.userId,
  });

  return json({ workflowId, status: "queued" }, { status: 202 });
});
