import { json } from "@sveltejs/kit";
import { z } from "zod";
import { postListSortSchema, postSubmitSchema, problemPostTypeSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, NotFoundError } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
  readJsonBody,
} from "$lib/server/shared/api-handler";
import { requireProblemPostAccess } from "$lib/server/post-access";
import { postDomain, problemDomain } from "@nojv/application";

const { createPost, listPostsPage } = postDomain;
const { getProblemRowById } = problemDomain;

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
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  const query = listQuerySchema.parse(Object.fromEntries(event.url.searchParams));

  await requireProblemPostAccess(actor.userId, id, query.type, actor.platformRole === "admin");

  const page = await listPostsPage({
    problemId: id,
    type: query.type,
    viewerId: actor.userId,
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
  });

  return json(page);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  const payload = postCreateBodySchema.parse(await readJsonBody(event));

  const problem = await getProblemRowById(id);
  if (!problem) throw new NotFoundError("Problem not found.");

  const post = await createPost(actor, {
    type: payload.type,
    problemId: id,
    title: payload.title,
    content: payload.content,
  });

  return json(post, { status: 201 });
});
