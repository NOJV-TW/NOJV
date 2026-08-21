import { error, redirect } from "@sveltejs/kit";

import { examDomain, problemDomain } from "@nojv/application";

import { requireAuth } from "$lib/server/auth";
import { getClientIp } from "$lib/server/shared/client-ip";
import { handleLoad } from "$lib/server/shared/load-wrapper";
import { loadProblemSolveData } from "$lib/server/problem-solve";

import type { PageServerLoad, PageServerLoadEvent } from "./$types";

export const load: PageServerLoad = handleLoad(async (event: PageServerLoadEvent) => {
  const actor = requireAuth(event);
  const { examId, problemId } = event.params;
  const parent = await event.parent();

  if (parent.isManager) {
    const detail = await examDomain.getExamDetailPage(examId, {
      viewerUserId: actor.userId,
      isManager: true,
    });
    if (!detail?.problems.some((problem) => problem.id === problemId)) {
      error(404, "Problem not found in this exam");
    }

    const solveProps = await loadProblemSolveData(problemId, actor, {
      kind: "preview",
      allowedLanguages: [],
      backLink: { href: `/exams/${examId}`, type: "exam" },
      problemInScope: true,
    });
    return { mode: "preview" as const, solveProps };
  }

  const exam = await examDomain.getExamById(examId);
  if (!exam) error(404, "Exam not found");
  if (new Date() > exam.endsAt) {
    redirect(302, `/problems/${problemId}?ended=exam`);
  }

  await examDomain.session.requireActiveSessionForUserExam(actor.userId, examId);

  const [view, testcaseSets] = await Promise.all([
    examDomain.getExamProblemViewByProblemId({
      examId,
      problemId,
      actorUserId: actor.userId,
    }),
    problemDomain.getProblemTestcaseSets(problemId),
  ]);

  if (!view) {
    error(404, "Problem not found in this exam");
  }

  const countdownMs = Math.max(0, new Date(view.exam.endsAt).getTime() - Date.now());

  return {
    mode: "exam" as const,
    problem: view.problem,
    submissions: view.submissions,
    testcaseSets: testcaseSets.map((set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      weight: set.weight,
      ordinal: set.ordinal,
      caseCount: set.testcases.length,
    })),
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
