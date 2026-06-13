import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { editorialDomain, problemDomain, submissionDomain } from "@nojv/application";

const {
  assertProblemViewAccess,
  getProblemPageData,
  getProblemRowById,
  getProblemTestcaseSets,
} = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;
const { canViewEditorials, resolveActiveContextForUser } = editorialDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const { locals, params } = event;
  const { problemId } = params;
  const actor = locals.sessionUser;
  if (!actor) {
    error(401, "Login required");
  }
  const userId = actor.id;
  const actorContext = requireAuth(event);

  const problemRow = await getProblemRowById(problemId);

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

  const [problem, fullTestcaseSets, submissions, editorialContext, canRejudge, bookmarked] =
    await Promise.all([
      getProblemPageData(problemId),
      getProblemTestcaseSets(problemId),
      listProblemSubmissions(userId, problemId),
      resolveActiveContextForUser(userId, problemId, new Date()),
      canOperateOnSubmission(actorContext, {
        id: "",
        userId,
        problemId,
        contestId: null,
        assessmentId: null,
        examId: null,
      }),
      problemDomain.isBookmarked(userId, problemId),
    ]);

  const testcaseSetSummaries = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length,
  }));

  const editorialAccess = await canViewEditorials(userId, problemId, editorialContext);

  return {
    allowedLanguages: [],
    assignmentProp: undefined,
    backLink: undefined,
    canRejudge,
    canViewEditorials: editorialAccess,
    contestId: undefined,
    problem: { ...problem, bookmarked },
    submissions,
    testcaseSets: testcaseSetSummaries,
  };
});
