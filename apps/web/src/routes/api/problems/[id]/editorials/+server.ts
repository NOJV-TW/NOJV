import { z } from "zod";
import { json } from "@sveltejs/kit";
import { languageSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { editorialDomain, problemDomain } from "@nojv/domain";

const { getProblemRowById } = problemDomain;
const { canViewEditorials, listProblemEditorials, upsertEditorial } = editorialDomain;

const editorialSubmitSchema = z.object({
  content: z.string().min(10).max(50000),
  language: languageSchema,
});

// problemRepo.findById and canViewEditorials are independent — both accept
// the same problemId, and canViewEditorials is a count query that safely
// returns false for an unknown problem. Fire them in parallel; the
// NotFoundError still takes precedence over the ForbiddenError.
async function requireProblemWithAc(
  userId: string,
  problemId: string,
  acError = "Solve this problem first to view editorials.",
) {
  const [problem, canView] = await Promise.all([
    getProblemRowById(problemId),
    canViewEditorials(userId, problemId),
  ]);

  if (!problem) throw new NotFoundError("Problem not found.");
  if (!canView) throw new ForbiddenError(acError);

  return problem;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  // editorialRepo.listByProblemId also only needs `id` and is safe to run
  // alongside the auth gate — on the rare error path the wasted query has
  // no side effects, and on the common happy path we save another round-trip.
  const [, editorials] = await Promise.all([
    requireProblemWithAc(actor.userId, id),
    listProblemEditorials(id),
  ]);

  return json(editorials);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  const problem = await requireProblemWithAc(
    actor.userId,
    id,
    "Solve this problem first to post an editorial.",
  );
  const payload = editorialSubmitSchema.parse(await event.request.json());

  const editorial = await upsertEditorial(
    actor.userId,
    problem.id,
    payload.content,
    payload.language,
  );

  return json(editorial, { status: 200 });
});
