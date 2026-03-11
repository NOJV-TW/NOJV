import { submissionDraftSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { withAuth } from "$lib/server/api-handler";
import { createQueuedSubmissionRecord } from "$lib/server/data-access/submissions";
import { dispatchSubmissionJob } from "$lib/server/queue";

export const POST = withAuth(async (event, actor) => {
  const payload = submissionDraftSchema.parse(await event.request.json());
  const submission = await createQueuedSubmissionRecord(payload, actor);
  await dispatchSubmissionJob({
    draft: payload,
    submissionId: submission.id
  });

  return json(
    {
      pollUrl: `/api/submissions/${submission.id}`,
      status: submission.status,
      submissionId: submission.id
    },
    { status: 202 }
  );
});
