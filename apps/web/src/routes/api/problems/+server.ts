import { problemCreateSchema } from "@nojv/domain";
import { json } from "@sveltejs/kit";

import { ForbiddenError } from "$lib/server/api-errors";
import { withAuth } from "$lib/server/api-handler";
import { createProblemRecord } from "$lib/server/data-access/problems";

export const POST = withAuth(async (event, actor) => {
  if (actor.platformRole === "student") {
    throw new ForbiddenError("Only teachers and admins can create problems.");
  }

  const payload = problemCreateSchema.parse(await event.request.json());
  const result = await createProblemRecord(actor, payload);

  return json(result, { status: 201 });
});
