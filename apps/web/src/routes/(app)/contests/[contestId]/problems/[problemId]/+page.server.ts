import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/application";

const { getContestWorkspaceData, listContestProblemSiblings } = contestDomain;
const { getProblemPageData, getProblemTestcaseSetSummaries } = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  event.depends("submission:data");
  const actor = requireAuth(event);
  const { contestId, problemId } = event.params;
  const now = new Date();

  const contestData = await getContestWorkspaceData(contestId, actor.userId, {
    now,
    platformRole: actor.platformRole,
  });

  if (contestData.problemsHidden) {
    redirect(303, `/contests/${contestId}`);
  }

  const problemsList = contestData.problems ?? [];
  if (!problemsList.some((p) => p.id === problemId)) {
    error(404, m.contestDetail_problemNotFound());
  }

  if (!contestData.isManager && now > new Date(contestData.endsAt)) {
    redirect(302, `/problems/${problemId}`);
  }

  const [problem, submissions, testcaseSets] = await Promise.all([
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId, { contestId }),
    getProblemTestcaseSetSummaries(problemId),
  ]);

  if (!contestData.isManager && !contestData.participation) {
    redirect(303, `/contests/${contestId}`);
  }

  const canRejudge = await canOperateOnSubmission(actor, {
    id: "",
    userId: actor.userId,
    problemId,
    contestId,
    assessmentId: null,
    examId: null,
  });

  const siblingProblems = contestData.problems
    ? await listContestProblemSiblings({
        contestId,
        problems: contestData.problems,
        activeProblemId: problemId,
        actorUserId: actor.userId,
      })
    : [];

  return {
    canRejudge,
    contestData,
    contestId,
    problem,
    siblingProblems,
    submissions,
    testcaseSets,
  };
});
