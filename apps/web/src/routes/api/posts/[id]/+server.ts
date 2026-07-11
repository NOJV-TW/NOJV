import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { postUpdateSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { HttpError, requireApiAuth } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { requireViewablePost } from "$lib/server/post-access";
import { postDomain } from "@nojv/application";

const { updatePost, softDeletePost } = postDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Post id is required.", 400);
  return id;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);

  const post = await requireViewablePost(id, actor);
  return json(post);
});

export const PATCH: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = postUpdateSchema.parse(await readJsonBody(event));

  const input: { title?: string; content?: string } = {};
  if (payload.title !== undefined) input.title = payload.title;
  if (payload.content !== undefined) input.content = payload.content;

  const updated = await updatePost(actor, id, input);
  return json(updated);
});

export const DELETE: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await softDeletePost(actor, id);
  return new Response(null, { status: 204 });
});
