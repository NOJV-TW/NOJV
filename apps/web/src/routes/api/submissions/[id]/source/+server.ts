import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { submissionDomain } from "@nojv/domain";

const { getSubmissionForUser, getSubmissionSources } = submissionDomain;

// Returns the submission's source files in storage order. Multi-file
// submissions emit one entry per file; full_source returns a single entry
// at `main.<ext>`. The caller is responsible for picking / rendering.
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing submission id." }, { status: 400 });

  const submission = await getSubmissionForUser(
    id,
    actor.userId,
    actor.platformRole === "admin",
  );

  const files = await getSubmissionSources(submission.id);
  return json({ files, language: submission.language });
});
