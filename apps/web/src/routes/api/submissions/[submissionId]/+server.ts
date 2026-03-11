import { getSubmissionOperation } from "@nojv/db";
import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext, hasActorHandle, HttpError, NotFoundError } from "$lib/server/auth";

export const GET: RequestHandler = async (event) => {
  try {
    const actor = getActorContext(event);
    if (!actor) return json({ message: "Authentication required." }, { status: 401 });
    if (!hasActorHandle(actor)) return json({ message: "Complete your profile first." }, { status: 403 });

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
  } catch (error) {
    if (error instanceof HttpError) return json({ message: error.message }, { status: error.status });
    console.error("Unhandled error:", error);
    return json({ message: "Internal server error." }, { status: 500 });
  }
};
