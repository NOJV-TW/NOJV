import { error, redirect } from "@sveltejs/kit";

import { problemDomain, virtualContestDomain } from "@nojv/domain";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

const { getProblemPageData } = problemDomain;
const { getVirtualContestForUser, listVirtualContestProblemSubmissions } = virtualContestDomain;

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { contestId, problemId } = event.params;
  const now = new Date();

  const virtual = await getVirtualContestForUser(contestId, actor.userId, now);
  if (!virtual) {
    redirect(303, `/contests/${contestId}/virtual`);
  }
  if (virtual.status === "finished") {
    redirect(303, `/contests/${contestId}/virtual`);
  }

  const problemInContest = virtual.problems.find((p) => p.problemId === problemId);
  if (!problemInContest) {
    error(404, "Problem not found in this contest.");
  }

  const [problem, submissions] = await Promise.all([
    getProblemPageData(problemId),
    listVirtualContestProblemSubmissions(virtual.participationId, actor.userId, problemId),
  ]);

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
