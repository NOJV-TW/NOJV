import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { submissionDomain } from "@nojv/application";

const { getSubmissionForActor, getSubmissionSources } = submissionDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForActor(actor, id);

  const files = await getSubmissionSources(submission.id);
  return Response.json({ files, language: submission.language });
});
