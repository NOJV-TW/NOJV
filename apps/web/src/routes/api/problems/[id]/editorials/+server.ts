import { json } from "@sveltejs/kit";
import { editorialSubmitSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import {
  apiHandler,
  writeApiHandler,
  assertJsonBodyWithinLimit,
} from "$lib/server/shared/api-handler";
import { editorialDomain, problemDomain } from "@nojv/domain";

const { getProblemRowById } = problemDomain;
const {
  canViewEditorials,
  listProblemEditorials,
  resolveActiveContextForUser,
  upsertEditorial,
} = editorialDomain;
type EditorialViewContext = editorialDomain.EditorialViewContext;

async function requireProblemWithAc(
  userId: string,
  problemId: string,
  context: EditorialViewContext,
  acError = "Solve this problem first to view editorials.",
) {
  const [problem, canView] = await Promise.all([
    getProblemRowById(problemId),
    canViewEditorials(userId, problemId, context),
  ]);

  if (!problem) throw new NotFoundError("Problem not found.");
  if (!canView) throw new ForbiddenError(acError);

  return problem;
}

export const GET: RequestHandler = apiHandler(async (event) => {
  const actor = requireApiAuth(event);
  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  const context = await resolveActiveContextForUser(actor.userId, id, new Date());

  const [, editorials] = await Promise.all([
    requireProblemWithAc(actor.userId, id, context),
    listProblemEditorials(id, actor.userId),
  ]);

  return json(editorials);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
  assertJsonBodyWithinLimit(event);
  const actor = requireApiAuth(event);

  const { id } = event.params;
  if (!id) return json({ message: "Missing problem ID." }, { status: 400 });

  const context = await resolveActiveContextForUser(actor.userId, id, new Date());

  const problem = await requireProblemWithAc(
    actor.userId,
    id,
    context,
    "Solve this problem first to post an editorial.",
  );
  const payload = editorialSubmitSchema.parse(await event.request.json());

  const editorial = await upsertEditorial(
    actor.userId,
    problem.id,
    payload.title,
    payload.content,
    payload.language,
  );

  return json(editorial, { status: 200 });
});
