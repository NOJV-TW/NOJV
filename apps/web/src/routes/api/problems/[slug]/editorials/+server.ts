import { z } from "zod";
import { json } from "@sveltejs/kit";
import { languageSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import { writeApiRateLimiter } from "$lib/server/shared/rate-limiter";
import { problemDomain } from "@nojv/domain";

const { findProblemIdBySlug, hasUserAcProblem, listEditorials, upsertEditorial } = problemDomain;

const editorialSubmitSchema = z.object({
  content: z.string().min(10).max(50000),
  language: languageSchema
});

async function requireProblemWithAc(userId: string, slug: string) {
  const problem = await findProblemIdBySlug(slug);

  if (!problem) throw new NotFoundError("Problem not found.");

  const ac = await hasUserAcProblem(userId, problem.id);
  if (!ac) throw new ForbiddenError("Solve this problem first to view editorials.");

  return problem;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { slug } = event.params;
  if (!slug) return json({ message: "Missing problem slug." }, { status: 400 });

  const problem = await requireProblemWithAc(actor.userId, slug);
  const editorials = await listEditorials(problem.id);

  return json(editorials);
});

export const POST: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);

  try {
    await writeApiRateLimiter.consume(event.getClientAddress());
  } catch {
    return json({ error: "Too many requests" }, { status: 429 });
  }

  const { slug } = event.params;
  if (!slug) return json({ message: "Missing problem slug." }, { status: 400 });

  const problem = await requireProblemWithAc(actor.userId, slug);
  const payload = editorialSubmitSchema.parse(await event.request.json());

  const editorial = await upsertEditorial(
    actor.userId,
    problem.id,
    payload.content,
    payload.language
  );

  return json(editorial, { status: 200 });
});
