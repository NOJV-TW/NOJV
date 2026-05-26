import { json, type RequestHandler } from "@sveltejs/kit";
import { submissionDomain } from "@nojv/domain";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";

const { getSubmissionForUser } = submissionDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForUser(
    id,
    actor.userId,
    actor.platformRole === "admin",
  );

  return json({ sourceCode: submission.sourceCode });
});