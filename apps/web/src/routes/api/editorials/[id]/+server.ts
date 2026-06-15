import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { editorialUpdateSchema, type Language } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import { writeApiHandler, assertJsonBodyWithinLimit } from "$lib/server/shared/api-handler";
import { editorialDomain } from "@nojv/application";

const { updateEditorial, softDeleteEditorial } = editorialDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Editorial id is required.", 400);
  return id;
}

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = editorialUpdateSchema.parse(await event.request.json());

  const input: { content?: string; language?: Language } = {};
  if (payload.content !== undefined) input.content = payload.content;
  if (payload.language !== undefined) input.language = payload.language;
  const updated = await updateEditorial(actor, id, input);
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await softDeleteEditorial(actor, id);
  return new Response(null, { status: 204 });
});
