import { submissionDraftSchema } from "@nojv/core";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { dispatchSubmissionJob } from "$lib/server/queue";
import { apiHandler } from "$lib/server/shared/api-handler";
import { createQueuedSubmissionRecord } from "$lib/server/submission/mutations";

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

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
