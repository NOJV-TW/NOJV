import { z } from "zod";
import { postListSortSchema, postSubmitSchema, problemPostTypeSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth } from "#lib/server/auth.js";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "#lib/server/shared/api-handler.js";
import { requireProblemPostAccess } from "#lib/server/post-access.js";
import { postDomain } from "@nojv/application";

const { createPost, listPostsPage } = postDomain;

const listQuerySchema = z.object({
  type: problemPostTypeSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: postListSortSchema.default("new"),
});

const postCreateBodySchema = postSubmitSchema.extend({
  type: problemPostTypeSchema,
});

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing problem ID." }, { status: 400 });

  const query = listQuerySchema.parse(Object.fromEntries(event.url.searchParams));

  await requireProblemPostAccess(actor, id, query.type);

  const page = await listPostsPage({
    problemId: id,
    type: query.type,
    viewerId: actor.userId,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
  });

  return Response.json(page);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return Response.json({ message: "Missing problem ID." }, { status: 400 });

  const payload = postCreateBodySchema.parse(await readJsonBody(event));

  const post = await createPost(actor, {
    type: payload.type,
    problemId: id,
    title: payload.title,
    content: payload.content,
  });

  return Response.json(post, { status: 201 });
});
