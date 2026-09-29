import { problemDomain, submissionDomain } from "@nojv/application";
import type { Language } from "@nojv/core";

import type { CompletedActorContext } from "$lib/server/auth";

type ProblemSolveContext =
  | {
      kind: "assignment";
      assignmentId: string;
      courseId: string;
      allowedLanguages: Language[];
      backLink: { href: string; type: "assignment" };
    }
  | {
      kind: "preview";
      allowedLanguages: Language[];
      backLink: { href: string; type: "exam" };
    };

export async function loadProblemSolveData(
  problemId: string,
  actor: CompletedActorContext,
  context: ProblemSolveContext,
) {
  const { access, problem } = await problemDomain.getProblemPageDataWithAccess(problemId);

  await problemDomain.assertProblemViewAccess(access, actor, {
    contextIncludesProblem: true,
  });

  const assignment =
    context.kind === "assignment"
      ? { assignmentId: context.assignmentId, courseId: context.courseId }
      : undefined;

  const [testcaseSets, submissions, canRejudge] = await Promise.all([
    problemDomain.getProblemTestcaseSetSummaries(problemId),
    submissionDomain.listProblemSubmissions(actor.userId, problemId, assignment),
    submissionDomain.canOperateOnSubmission(actor, {
      id: "",
      userId: actor.userId,
      problemId,
      assessmentId: assignment?.assignmentId ?? null,
    }),
  ]);

  return {
    allowedLanguages: context.allowedLanguages,
    assignmentProp: assignment && {
      assessmentId: assignment.assignmentId,
      courseId: assignment.courseId,
    },
    backLink: context.backLink,
    canRejudge,
    contestId: undefined,
    problem,
    submissions,
    testcaseSets,
  };
}
