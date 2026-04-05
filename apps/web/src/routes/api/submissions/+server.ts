import { submissionDraftSchema } from "@nojv/core";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { dispatchSubmissionJob } from "$lib/server/queue";
import { apiHandler } from "$lib/server/shared/api-handler";
import { writeApiRateLimiter } from "$lib/server/shared/rate-limiter";
import { createQueuedSubmissionRecord } from "$lib/server/submission/mutations";

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  try {
    await writeApiRateLimiter.consume(event.getClientAddress());
  } catch {
    return json({ error: "Too many requests" }, { status: 429 });
  }

  const rawPayload: unknown = await event.request.json();

  if (rawPayload && typeof rawPayload === "object") {
    const draft = rawPayload as Record<string, unknown>;
    const problemId = typeof draft.problemId === "string" ? draft.problemId : undefined;
    const problemSlug = typeof draft.problemSlug === "string" ? draft.problemSlug : undefined;

    if (!problemId && problemSlug) {
      draft.problemId = problemSlug;
    }

    if (!problemSlug && problemId) {
      draft.problemSlug = problemId;
    }
  }

  const parsedPayload = submissionDraftSchema.parse(rawPayload);
  const draftWithAliases = parsedPayload as Record<string, unknown>;
  const parsedProblemId =
    typeof draftWithAliases.problemId === "string" ? draftWithAliases.problemId : undefined;
  const parsedProblemSlug =
    typeof draftWithAliases.problemSlug === "string" ? draftWithAliases.problemSlug : undefined;
  const normalizedProblemId = parsedProblemId ?? parsedProblemSlug;

  if (!normalizedProblemId) {
    return json(
      { message: "Invalid submission payload: missing problem identifier." },
      { status: 400 }
    );
  }

  const payload = {
    ...parsedPayload,
    problemId: normalizedProblemId,
    problemSlug: normalizedProblemId
  };

  const submission = await createQueuedSubmissionRecord(payload, actor, event.request);
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
