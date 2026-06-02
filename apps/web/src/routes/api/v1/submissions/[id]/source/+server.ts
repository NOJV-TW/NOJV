import { json } from "@sveltejs/kit";
import { submissionDomain } from "@nojv/domain";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";

const { getSubmissionForUser, getSubmissionSources } = submissionDomain;

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const id = event.params.id;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForUser(
    id,
    actor.userId,
    actor.platformRole === "admin",
  );

  const files = await getSubmissionSources(submission.id);
  return json({ files, language: submission.language });
});
