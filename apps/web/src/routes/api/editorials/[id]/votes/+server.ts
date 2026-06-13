import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { editorialVoteSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, assertJsonBodyWithinLimit } from "$lib/server/shared/api-handler";
import { editorialDomain } from "@nojv/application";

const { castEditorialVote } = editorialDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Editorial id is required.", 400);
  return id;
}

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = editorialVoteSchema.parse(await event.request.json());

  const result = await castEditorialVote(actor, id, payload.value);
  return json(result);
});
