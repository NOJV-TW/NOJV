import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getContestWorkspaceData } = contestDomain;
const { getProblemPageData } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const { slug: contestSlug, problemId } = event.params;
  const now = new Date();

  const [contestData, problem, submissions] = await Promise.all([
    getContestWorkspaceData(contestSlug, actor.userId, { now }),
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId)
  ]);

  if (!contestData) {
    error(404, "Contest not found");
  }

  if (!problem) {
    error(404, "Problem not found");
  }

  // A manager may preview any problem in the contest even before start.
  // Non-managers still require the contest to be active.
  const problemsList = contestData.problems ?? [];
  const isContestProblem = problemsList.some((p) => p.id === problemId);

  if (!isContestProblem && !contestData.isManager) {
    error(404, "Problem not found in this contest");
  }

  if (!contestData.isManager) {
    if (now < new Date(contestData.startsAt)) {
      redirect(303, `/contests/${contestSlug}`);
    }
    if (now > new Date(contestData.endsAt)) {
      redirect(303, `/contests/${contestSlug}`);
    }
  }

  return {
    contestData,
    contestSlug,
    problem,
    submissions
  };
};
