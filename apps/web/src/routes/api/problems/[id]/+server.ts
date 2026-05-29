import { json } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { ForbiddenError, NotFoundError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { problemDomain } from "@nojv/domain";

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing problem id." }, { status: 400 });

  await problemDomain.assertProblemEditAccess(actor, id);

  const problem = await problemDomain.getProblemRowById(id);
  if (!problem) throw new NotFoundError("Problem not found.");
  if (problem.status !== "draft") {
    throw new ForbiddenError("Only draft problems can be deleted.");
  }

  await problemDomain.deleteProblemRecord(actor, id);
  return new Response(null, { status: 204 });
});
