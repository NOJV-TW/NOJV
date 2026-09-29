import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { postDomain, problemDomain, submissionDomain } from "@nojv/application";

const {
  assertProblemViewAccess,
  getProblemPageDataWithAccess,
  getProblemTestcaseSetSummaries,
} = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;
const { canViewPosts, resolveActiveContextForUser } = postDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  event.depends("submission:data");
  const { locals, params } = event;
  const { problemId } = params;
  const actor = locals.sessionUser;
  if (!actor) {
    error(401, "Login required");
  }
  const userId = actor.id;
  const actorContext = requireAuth(event);

  const [
    { access, problem },
    testcaseSets,
    submissions,
    editorialContext,
    canRejudge,
    bookmarked,
  ] = await Promise.all([
    getProblemPageDataWithAccess(problemId),
    getProblemTestcaseSetSummaries(problemId),
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

  await assertProblemViewAccess(access, actorContext, { contextIncludesProblem: false });

  const editorialAccess =
    actorContext.platformRole === "admin" ||
    (await canViewPosts(userId, problemId, "editorial", editorialContext));

  return {
    allowedLanguages: [],
    assignmentProp: undefined,
    backLink: { href: "/problems", type: "problems" as const },
    canRejudge,
    canViewEditorials: editorialAccess,
    contestId: undefined,
    problem: { ...problem, bookmarked },
    submissions,
    testcaseSets,
  };
});
