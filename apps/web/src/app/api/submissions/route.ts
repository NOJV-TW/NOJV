import { submissionDraftSchema } from "@nojv/domain";
import { NextResponse } from "next/server";

import { withAuth } from "@/lib/server/api-handler";
import { createQueuedSubmissionRecord } from "@/lib/server/data-access/submissions";
import { dispatchSubmissionJob } from "@/lib/server/queue";

export const POST = withAuth(async (request, actor) => {
  const payload = submissionDraftSchema.parse(await request.json());
  const submission = await createQueuedSubmissionRecord(payload, actor);
  await dispatchSubmissionJob({
    draft: payload,
    submissionId: submission.id
  });

  return NextResponse.json(
    {
      pollUrl: `/api/submissions/${submission.id}`,
      status: submission.status,
      submissionId: submission.id
    },
    { status: 202 }
  );
});
