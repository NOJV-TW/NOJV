import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import { apiHandler } from "#lib/server/shared/api-handler.js";
import { problemDomain } from "@nojv/application";

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(actor, problemId);

  const usage = await problemDomain.getProblemStorageUsage(problemId);
  return Response.json(usage);
});
