import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { m } from "$lib/paraglide/messages.js";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getContestWorkspaceData } = contestDomain;
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
      platformRole: actor.platformRole
    }),
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId)
  ]);

  // A manager may preview any problem in the contest even before start.
  // Non-managers still require the contest to be active.
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
      // Contest has ended. Practice-after-close sends the student to the
      // plain problem page — no scoreboard, no cooldown, no frozen
      // participation. assertProblemViewAccess on the target route
      // admits past participants via the historical-participant gate.
      redirect(302, `/problems/${problemId}`);
    }
  }

  // Submissions on this route all live in the same contest context, so
  // the rejudge authz decision is homogeneous — compute once.
  const canRejudge = await canOperateOnSubmission(actor, {
    id: "",
    userId: actor.userId,
    problemId,
    contestId,
    courseAssessmentId: null,
    examId: null
  });

  return {
    canRejudge,
    contestData,
    contestId,
    problem,
    submissions
  };
});
