import { error } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { assessmentProblemRepo } from "@nojv/db";
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

  // Non-managers: enforce the assessment window here — the shell layout
  // lets `upcoming` through so the detail page can render a locked view,
  // but the problem page itself must reject `upcoming` and `closed`.
  if (!isManager) {
    const now = new Date();
    const opens = new Date(assessment.opensAt);
    const closes = new Date(assessment.closesAt);
    if (now < opens || now > closes) {
      error(404, "Problem not available.");
    }
  }

  const problemInScope = await assessmentProblemRepo.exists(assessment.id, problemId);
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

  return { solveProps };
});
