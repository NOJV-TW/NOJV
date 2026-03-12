import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { getActorContext, hasActorHandle } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { getSubmissionForUser } from "$lib/server/submission/queries";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = getActorContext(event);
  if (!actor) return json({ message: "Authentication required." }, { status: 401 });
  if (!hasActorHandle(actor))
    return json({ message: "Complete your profile first." }, { status: 403 });

  const { submissionId } = event.params;
  if (!submissionId) return json({ message: "Missing submissionId." }, { status: 400 });

  const submission = await getSubmissionForUser(
    submissionId,
    actor.userId,
    actor.platformRole === "admin"
  );

  return json({
    result: submission.verdictDetail,
    status: submission.status,
    submissionId: submission.id
  });
});
