import { submissionDraftSchema } from "@nojv/core";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { dispatchSubmissionJob } from "$lib/server/queue";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { createQueuedSubmissionRecord } from "$lib/server/submission/mutations";

/** Accept `problemSlug` as a legacy alias for `problemId` before validation. */
function normalizeProblemIdAlias(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const draft = payload as Record<string, unknown>;
  if (!draft.problemId && typeof draft.problemSlug === "string") {
    return { ...draft, problemId: draft.problemSlug };
  }
  return payload;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const raw = normalizeProblemIdAlias(await event.request.json());
  const payload = submissionDraftSchema.parse(raw);

  const submission = await createQueuedSubmissionRecord(payload, actor, event.request);
  await dispatchSubmissionJob({ draft: payload, submissionId: submission.id });

  return json(
    {
      pollUrl: `/api/submissions/${submission.id}`,
      status: submission.status,
      submissionId: submission.id
    },
    { status: 202 }
  );
});
