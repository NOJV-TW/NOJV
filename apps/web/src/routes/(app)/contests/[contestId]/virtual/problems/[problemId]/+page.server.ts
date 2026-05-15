import { error, redirect } from "@sveltejs/kit";

import { problemDomain, virtualContestDomain } from "@nojv/domain";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getProblemPageData } = problemDomain;
const { getVirtualContestForUser, listVirtualContestProblemSubmissions } = virtualContestDomain;

/**
 * Virtual-contest solve workspace. Reuses the standard `ProblemSolveView`
 * (practice mode) but tags every submission with the run's `virtualContestId`.
 *
 * Guard rails:
 *  - the user must have started a virtual contest for this contest;
 *  - if the personal timer has expired, the loader redirects back to the
 *    dashboard (read-only) — finished runs are not solvable;
 *  - the problem must belong to the contest.
 */
export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { contestId, problemId } = event.params;
  const now = new Date();

  const virtual = await getVirtualContestForUser(contestId, actor.userId, now);
  if (!virtual) {
    redirect(303, `/contests/${contestId}/virtual`);
  }
  if (virtual.status === "finished") {
    // Timer expired — the run is over, no further submissions allowed.
    redirect(303, `/contests/${contestId}/virtual`);
  }

  const problemInContest = virtual.problems.find((p) => p.problemId === problemId);
  if (!problemInContest) {
    error(404, "Problem not found in this contest.");
  }

  const [problem, submissions] = await Promise.all([
    getProblemPageData(problemId),
    listVirtualContestProblemSubmissions(virtual.virtualContestId, actor.userId, problemId),
  ]);

  // Sibling list for the float problem switcher — scoped to the virtual run.
  const siblingProblems = virtual.problems.map((p) => ({
    id: p.problemId,
    letter: p.letter,
    title: p.title,
    bestScore: p.bestScore,
    maxScore: p.points,
    isActive: p.problemId === problemId,
    href: `/contests/${contestId}/virtual/problems/${p.problemId}`,
  }));

  return {
    contestId,
    virtual,
    problem,
    submissions,
    siblingProblems,
  };
});
