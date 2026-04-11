import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { contestDomain, problemDomain, submissionDomain } from "@nojv/domain";

const { getContestWorkspaceData } = contestDomain;
const { getProblemPageData } = problemDomain;
const { listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { slug: contestSlug, problemId } = event.params;
  const now = new Date();

  const [contestData, problem, submissions] = await Promise.all([
    getContestWorkspaceData(contestSlug, actor.userId, { now }),
    getProblemPageData(problemId),
    listProblemSubmissions(actor.userId, problemId)
  ]);

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
});
