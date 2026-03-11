import { submissionDraftSchema } from "@nojv/core";
import { json } from "@sveltejs/kit";
import { ZodError } from "zod";

import type { RequestHandler } from "./$types";

import { getActorContext, hasActorHandle, HttpError } from "$lib/server/auth";
import { createQueuedSubmissionRecord } from "$lib/server/db";
import { dispatchSubmissionJob } from "$lib/server/queue";

export const POST: RequestHandler = async (event) => {
  try {
    const actor = getActorContext(event);
    if (!actor) return json({ message: "Authentication required." }, { status: 401 });
    if (!hasActorHandle(actor)) return json({ message: "Complete your profile first." }, { status: 403 });

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
  } catch (error) {
    if (error instanceof ZodError) return json({ issues: error.issues }, { status: 400 });
    if (error instanceof HttpError) return json({ message: error.message }, { status: error.status });
    console.error("Unhandled error:", error);
    return json({ message: "Internal server error." }, { status: 500 });
  }
};
