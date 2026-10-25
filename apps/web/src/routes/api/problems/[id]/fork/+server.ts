import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/application";
import { requireApiAuth } from "#lib/server/auth.js";
import { writeApiHandler } from "#lib/server/shared/api-handler.js";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const sourceProblemId = event.params.id;
  if (!sourceProblemId)
    return Response.json({ message: "Missing problem id." }, { status: 400 });

  const fork = await problemDomain.forkProblemRecord(actor, sourceProblemId);
  return Response.json({ id: fork.id }, { status: 201 });
});
