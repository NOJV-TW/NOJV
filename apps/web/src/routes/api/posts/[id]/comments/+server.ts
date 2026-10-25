import type { RequestEvent } from "@sveltejs/kit";
import { postCommentSubmitSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "#lib/server/shared/api-handler.js";
import { requireViewablePost } from "#lib/server/post-access.js";
import { postDomain, HttpError } from "@nojv/application";

const { addComment, listComments } = postDomain;

function requireId(event: RequestEvent): string {
  const id = event.params.id;
  if (!id) throw new HttpError("Post id is required.", 400);
  return id;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const id = requireId(event);

  await requireViewablePost(id, actor);
  const comments = await listComments(id);
  return Response.json(comments);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);
  const id = requireId(event);
  const payload = postCommentSubmitSchema.parse(await readJsonBody(event));

  const comment = await addComment(actor, id, {
    content: payload.content,
    parentId: payload.parentId ?? null,
  });

  return Response.json(comment, { status: 201 });
});
