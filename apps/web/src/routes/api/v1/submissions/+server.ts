import { json, type RequestHandler } from "@sveltejs/kit";
import { submissionDraftSchema } from "@nojv/core";
import { submissionDomain } from "@nojv/domain";

import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { getClientIp } from "$lib/server/shared/client-ip";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const payload = submissionDraftSchema.parse(await event.request.json());

  const submission = await submissionDomain.createQueuedSubmissionRecord(
    payload,
    actor,
    getClientIp(event),
  );

  await submissionDomain.dispatchSubmissionJudge({
    draft: payload,
    submissionId: submission.id,
  });

  return json(
    {
      pollUrl: `/api/v1/submissions/${submission.id}`,
      status: submission.status,
      submissionId: submission.id,
    },
    { status: 202 },
  );
});
