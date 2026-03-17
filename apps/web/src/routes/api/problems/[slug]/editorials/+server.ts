import { z } from "zod";
import { json } from "@sveltejs/kit";
import { prisma } from "@nojv/db";
import { languageSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { apiHandler } from "$lib/server/shared/api-handler";
import {
  hasUserAcProblem,
  listEditorials,
  upsertEditorial
} from "$lib/server/problem/editorial-queries";

const editorialSubmitSchema = z.object({
  content: z.string().min(10).max(50000),
  language: languageSchema
});

async function requireProblemWithAc(userId: string, slug: string) {
  const problem = await prisma.problem.findUnique({
    where: { slug },
    select: { id: true }
  });

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
