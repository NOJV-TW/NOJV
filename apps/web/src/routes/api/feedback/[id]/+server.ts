import type { RequestEvent } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler } from "$lib/server/shared/api-handler";
import { feedbackDomain } from "@nojv/application";

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Feedback id is required.", 400);
  return id;
}

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);
  await feedbackDomain.deleteFeedback(actor, id);
  return new Response(null, { status: 204 });
});
