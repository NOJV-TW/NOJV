import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { assessmentDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadProblemSolveData } from "$lib/server/problem-solve";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assessment, isManager, course } = parent;
  const { problemId } = event.params;

  // Archived courses: non-managers lose click-through even after the
  // assessment closes.  Managers can still open the problem to review.
  if (!isManager && course.archived) {
    error(403, "This course is archived.");
  }

  let isEnded = false;
  if (!isManager) {
    const now = new Date();
    const opens = new Date(assessment.opensAt);
    const closes = new Date(assessment.closesAt);
    if (now < opens) {
      error(404, "Problem not available.");
    }
    isEnded = now > closes;
  }

  const problemInScope = await assessmentDomain.isProblemInAssessment(assessment.id, problemId);
  if (!problemInScope) {
    // 404 so we don't leak whether the problem exists outside this assignment.
    error(404, "Problem not found in this assignment.");
  }

  const solveProps = await loadProblemSolveData(problemId, actor, {
    kind: "assessment",
    assessmentId: assessment.id,
    courseId: assessment.courseId,
    allowedLanguages: assessment.allowedLanguages,
    backLink: {
      href: `/assignments/${assessment.id}`,
      type: "assignment",
    },
    problemInScope: true,
  });

  return { solveProps, isEnded };
});
