import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

const { getSubmissionForUser } = submissionDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { submissionId } = event.params;
  if (!submissionId) return json({ message: "Missing submissionId." }, { status: 400 });

  const submission = await getSubmissionForUser(
    submissionId,
    actor.userId,
    actor.platformRole === "admin"
  );

  return json({ sourceCode: submission.sourceCode });
});
