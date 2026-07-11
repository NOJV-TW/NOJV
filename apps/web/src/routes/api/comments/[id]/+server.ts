import type { RequestEvent } from "@sveltejs/kit";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, assertJsonBodyWithinLimit } from "$lib/server/shared/api-handler";
import { postDomain } from "@nojv/application";

const { softDeleteComment } = postDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Comment id is required.", 400);
  return id;
}

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await softDeleteComment(actor, id);
  return new Response(null, { status: 204 });
});
