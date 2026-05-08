import { error, redirect } from "@sveltejs/kit";

import { examDomain } from "@nojv/domain";
import { examRepo } from "@nojv/db";

import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { examId, problemId } = event.params;

  const exam = await examRepo.findById(examId);
  if (!exam) error(404, "Exam not found");
  if (new Date() > exam.endsAt) {
    redirect(302, `/problems/${problemId}?ended=exam`);
  }

  await examDomain.session.requireActiveSessionForUserExam(actor.userId, examId);

  const view = await examDomain.getExamProblemViewByProblemId({
    examId,
    problemId,
    actorUserId: actor.userId,
  });

  if (!view) {
    error(404, "Problem not found in this exam");
  }

  const countdownMs = Math.max(0, new Date(view.exam.endsAt).getTime() - Date.now());

  return {
    mode: "exam" as const,
    problem: view.problem,
    submissions: view.submissions,
    siblingProblems: view.siblingProblems,
    canRejudge: false,
    examContext: {
      examId,
      courseId: view.exam.courseId,
      examTitle: view.examTitle,
      courseLabel: view.courseLabel,
      endsAt: view.exam.endsAt,
      countdownMs,
      userHandle: actor.username,
      ipAddress: getClientIp(event),
    },
  };
});
