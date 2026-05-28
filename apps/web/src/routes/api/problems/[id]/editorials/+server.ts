import { json } from "@sveltejs/kit";
import { z } from "zod";
import { editorialSubmitSchema } from "@nojv/core";

import type { RequestHandler } from "./$types";

import { requireApiAuth, ForbiddenError, NotFoundError } from "$lib/server/auth";
import { apiHandler, writeApiHandler } from "$lib/server/shared/api-handler";
import { editorialDomain, problemDomain } from "@nojv/domain";

const { getProblemRowById } = problemDomain;
const { canViewEditorials, listProblemEditorials, upsertEditorial } = editorialDomain;
type EditorialViewContext = editorialDomain.EditorialViewContext;

// Wire shape for the optional `?context=...` query. Without it, the
// endpoint defaults to practice context (legacy behaviour). Embedded
// solve routes (assignment/contest/exam) must pass the matching context
// id so the gate honours the event's end time.
const contextQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("practice") }),
  z.object({ kind: z.literal("contest"), contestId: z.string().min(1) }),
  z.object({ kind: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ kind: z.literal("exam"), examId: z.string().min(1) }),
]);

function parseContextQuery(url: URL, now: Date): EditorialViewContext {
  const raw = url.searchParams.get("context");
  if (!raw) return { kind: "practice" };

  const parsed = contextQuerySchema.parse({
    kind: raw,
    contestId: url.searchParams.get("contestId") ?? undefined,
    assignmentId: url.searchParams.get("assignmentId") ?? undefined,
    examId: url.searchParams.get("examId") ?? undefined,
  });

  switch (parsed.kind) {
    case "practice":
      return { kind: "practice" };
    case "contest":
      return { kind: "contest", contestId: parsed.contestId, now };
    case "assignment":
      return { kind: "assignment", assignmentId: parsed.assignmentId, now };
    case "exam":
      return { kind: "exam", examId: parsed.examId, now };
  }
}

// problemRepo.findById and canViewEditorials are independent — both accept
// the same problemId, and canViewEditorials is a count query that safely
// returns false for an unknown problem. Fire them in parallel; the
// NotFoundError still takes precedence over the ForbiddenError.
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

  let context: EditorialViewContext;
  try {
    context = parseContextQuery(event.url, new Date());
  } catch {
    return json({ message: "Invalid context query." }, { status: 400 });
  }

  // editorialRepo.listByProblemId also only needs `id` and is safe to run
  // alongside the auth gate — on the rare error path the wasted query has
  // no side effects, and on the common happy path we save another round-trip.
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

  let context: EditorialViewContext;
  try {
    context = parseContextQuery(event.url, new Date());
  } catch {
    return json({ message: "Invalid context query." }, { status: 400 });
  }

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
