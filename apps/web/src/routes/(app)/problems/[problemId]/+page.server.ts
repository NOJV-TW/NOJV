import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { problemDomain, submissionDomain } from "@nojv/domain";
import { problemRepo } from "@nojv/db";

const { assertProblemViewAccess, getProblemPageData, getProblemTestcaseSets } = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { locals, params } = event;
  const { problemId } = params;
  const actor = locals.sessionUser;
  if (!actor) {
    // The layout is supposed to gate auth, but handle this defensively
    // since getProblemPageData has no requireAuth of its own.
    error(401, "Login required");
  }
  const userId = actor.id;
  const actorContext = requireAuth(event);

  // Practice mode only — assignment/contest/exam solves now have their
  // own route trees (`/assignments/[assessmentId]/problems/...`,
  // `/contests/[contestId]/problems/...`, `/exams/[examId]/problems/...`).
  const problemRow = await problemRepo.findById(problemId);

  if (!problemRow) {
    error(404, "Problem not found");
  }

  await assertProblemViewAccess(
    { id: problemRow.id, authorId: problemRow.authorId, visibility: problemRow.visibility },
    {
      userId,
      username: actor.username ?? "",
      platformRole: actor.platformRole,
    },
    { contextIncludesProblem: false },
  );

  // Now that we've confirmed view access, load the display payload +
  // testcase summaries (never leak hidden I/O — stripped at line below).
  const [problem, fullTestcaseSets] = await Promise.all([
    getProblemPageData(problemId),
    getProblemTestcaseSets(problemId),
  ]);

  // Testcase set summaries strip the actual input/output payloads —
  // students must never see hidden testcase contents.
  const testcaseSetSummaries = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length,
  }));

  const submissions = await listProblemSubmissions(userId, problemId);

  // Practice-context submissions carry no contest/assessment/exam id, so the
  // authz decision is homogeneous across the list — compute once. Uses a
  // synthetic submission shape (id/userId are irrelevant to the check).
  const canRejudge = await canOperateOnSubmission(actorContext, {
    id: "",
    userId,
    problemId,
    contestId: null,
    courseAssessmentId: null,
    examId: null,
  });

  return {
    allowedLanguages: [],
    assessmentProp: undefined,
    backLink: undefined,
    canRejudge,
    contestId: undefined,
    problem,
    submissions,
    testcaseSets: testcaseSetSummaries,
  };
});
