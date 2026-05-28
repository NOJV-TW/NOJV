import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

import { requireApiAuth } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

/**
 * GET /api/problems/[id]/storage-usage
 *
 * Returns aggregate bytes stored under `problems/{id}/` so the authoring
 * UI can render a "X / 50 MB" budget bar. Edit-access gated — usage is
 * staff-only metadata.
 */
export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const problemId = event.params.id;
  if (!problemId) error(400, "Missing problem id");

  await problemDomain.assertProblemEditAccess(
    { platformRole: actor.platformRole, userId: actor.userId, username: actor.username },
    problemId,
  );

  const usage = await problemDomain.getProblemStorageUsage(problemId);
  return json(usage);
});
