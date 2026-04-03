import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";
import { contestDomain, submissionDomain } from "@nojv/domain";
import { getProblemPageData } from "$lib/server/problem/queries";

const { getContestWorkspaceData } = contestDomain;
const { listProblemSubmissions } = submissionDomain;
import { requireAuth } from "$lib/server/auth";

export const load: PageServerLoad = async (event) => {
  const actor = requireAuth(event);
  const { slug: contestSlug, problemId } = event.params;

  const [contestData, problem] = await Promise.all([
    getContestWorkspaceData(contestSlug, actor.userId),
    getProblemPageData(problemId)
  ]);

  if (!contestData) {
    error(404, "Contest not found");
  }

  if (!problem) {
    error(404, "Problem not found");
  }

  // Verify the problem is part of this contest
  const isContestProblem = contestData.problems.some((p) => p.id === problemId);
  if (!isContestProblem) {
    error(404, "Problem not found in this contest");
  }

  // If contest hasn't started, redirect to contest page
  const now = new Date();
  if (now < new Date(contestData.startsAt)) {
    redirect(303, `/contests/${contestSlug}`);
  }

  // If contest has ended, redirect to contest page
  if (now > new Date(contestData.endsAt)) {
    redirect(303, `/contests/${contestSlug}`);
  }

  const submissions = await listProblemSubmissions(actor.userId, problemId);

  return {
    contestData,
    contestSlug,
    problem,
    submissions
  };
};
