import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getContestWorkspaceData, listContestProblemSiblings } = contestDomain;
const { getProblemPageData } = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { contestId, problemId } = event.params;
  const now = new Date();

  const [contestData, problem, submissions] = await Promise.all([
    getContestWorkspaceData(contestId, actor.userId, {
      now,
      platformRole: actor.platformRole,
    }),
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId, { contestId }),
  ]);

  const problemsList = contestData.problems ?? [];
  const isContestProblem = problemsList.some((p) => p.id === problemId);

  if (!isContestProblem && !contestData.isManager) {
    error(404, m.contestDetail_problemNotFound());
  }

  if (!contestData.isManager) {
    if (now < new Date(contestData.startsAt)) {
      redirect(303, `/contests/${contestId}`);
    }
    if (now > new Date(contestData.endsAt)) {
      redirect(302, `/problems/${problemId}`);
    }
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
  };
});
