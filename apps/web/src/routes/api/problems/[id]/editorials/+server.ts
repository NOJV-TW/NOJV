import { json } from "@sveltejs/kit";
import { editorialSubmitSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { editorialDomain, problemDomain } from "@nojv/domain";

const { getProblemRowById } = problemDomain;
const {
  canViewEditorials,
  listProblemEditorials,
  resolveActiveContextForUser,
  upsertEditorial,
} = editorialDomain;
type EditorialViewContext = editorialDomain.EditorialViewContext;

// problemRepo.findById, resolveActiveContextForUser and canViewEditorials are
// independent reads. NotFoundError on the problem still takes precedence over
// ForbiddenError from the gate.
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

  // Context is resolved server-side from (userId, problemId, now). Clients
  // MUST NOT be allowed to declare their own context — that lets a student
  // in a live event pick a lenient gate (e.g. practice or some unrelated
  // already-ended event) and bypass the editorial visibility rule.
  const context = await resolveActiveContextForUser(actor.userId, id, new Date());

  const [, editorials] = await Promise.all([
    requireProblemWithAc(actor.userId, id, context),
    listProblemEditorials(id),
  ]);

  return json(editorials);
});

export const POST: RequestHandler = writeApiHandler(async (event) => {
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
    payload.content,
    payload.language,
  );

  return json(editorial, { status: 200 });
});
