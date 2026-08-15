import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { problemDomain } from "@nojv/application";
import { requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const sourceProblemId = event.params.id;
  if (!sourceProblemId) return json({ message: "Missing problem id." }, { status: 400 });

  const fork = await problemDomain.forkProblemRecord(actor, sourceProblemId);
  return json({ id: fork.id }, { status: 201 });
});
