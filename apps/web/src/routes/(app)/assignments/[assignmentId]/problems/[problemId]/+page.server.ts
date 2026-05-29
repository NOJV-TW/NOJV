import { error, redirect } from "@sveltejs/kit";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";
import { assignmentDomain, submissionDomain } from "@nojv/domain";
import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadProblemSolveData } from "$lib/server/problem-solve";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const parent = await event.parent();
  const { assignment, isManager, course } = parent;
  const { problemId } = event.params;

  if (!isManager && course.archived) {
    error(403, "This course is archived.");
  }

  if (!isManager) {
    const now = new Date();
    const opens = new Date(assignment.opensAt);
    const closes = new Date(assignment.closesAt);
    if (now < opens) {
      error(404, "Problem not available.");
    }
    if (now > closes) {
      redirect(302, `/problems/${problemId}?ended=assignment`);
    }
  }

  const problemInScope = await assignmentDomain.isProblemInAssignment(assignment.id, problemId);
  if (!problemInScope) {
    error(404, "Problem not found in this assignment.");
  }

  const [solveProps, siblingProblems] = await Promise.all([
    loadProblemSolveData(problemId, actor, {
      kind: "assignment",
      assignmentId: assignment.id,
      courseId: assignment.courseId,
      allowedLanguages: assignment.allowedLanguages,
      backLink: {
        href: `/assignments/${assignment.id}`,
        type: "assignment",
      },
      problemInScope: true,
    }),
    assignmentDomain.listAssignmentProblemSiblings({
      assignmentId: assignment.id,
      activeProblemId: problemId,
      actorUserId: actor.userId,
    }),
  ]);

  const dailyAttempts = isManager
    ? null
    : {
        used: await submissionDomain.countAssignmentSubmissionsToday(
          actor.userId,
          assignment.id,
        ),
        max: assignment.maxAttemptsPerDay,
      };

  return { solveProps, siblingProblems, dailyAttempts };
});
