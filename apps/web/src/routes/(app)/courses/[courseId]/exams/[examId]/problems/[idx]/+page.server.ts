import { error } from "@sveltejs/kit";

import { examDomain } from "@nojv/domain";

import { requireAuth } from "$lib/server/auth";
import { handleLoad } from "$lib/server/shared/load-wrapper";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { courseId, examId, idx } = event.params;

  const problemIdx = Number(idx);
  if (!Number.isInteger(problemIdx) || problemIdx < 0) {
    error(404, "Invalid problem index");
  }

  // Defense in depth so a bypassed `hooks.server.ts` exam lock cannot expose exam content.
  await examDomain.session.requireActiveSessionForUserExam(actor.userId, examId);

  const view = await examDomain.getExamProblemView({
    examId,
    problemIdx,
    actorUserId: actor.userId
  });

  if (!view) {
    error(404, "Problem not found in this exam");
  }

  // Compute countdownMs at load time so the page has an initial value
  // before the client tick takes over. Negative values are clamped.
  const countdownMs = Math.max(0, new Date(view.exam.endsAt).getTime() - Date.now());

  return {
    mode: "exam" as const,
    problem: view.problem,
    submissions: view.submissions,
    siblingProblems: view.siblingProblems,
    examContext: {
      examId,
      courseId,
      examTitle: view.examTitle,
      courseLabel: view.courseLabel,
      endsAt: view.exam.endsAt,
      countdownMs,
      userHandle: actor.username,
      ipAddress: event.getClientAddress()
    }
  };
});
