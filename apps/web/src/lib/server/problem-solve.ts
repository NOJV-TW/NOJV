import { error } from "@sveltejs/kit";

import { problemDomain, submissionDomain } from "@nojv/domain";
import type { Language } from "@nojv/core";

const {
  assertProblemViewAccess,
  getProblemPageData,
  getProblemRowById,
  getProblemTestcaseSets,
} = problemDomain;
const { canOperateOnSubmission, listProblemSubmissions } = submissionDomain;

import type { ActorContext } from "$lib/server/auth";

export type ProblemSolveContext =
  | {
      kind: "assignment";
      assignmentId: string;
      courseId: string;
      allowedLanguages: Language[];
      backLink: { href: string; type: "assignment" };
      problemInScope: boolean;
    }
  | {
      kind: "contest";
      contestId: string;
      allowedLanguages: Language[];
      backLink: { href: string; type: "contest" };
      problemInScope: boolean;
    }
  | {
      kind: "exam";
      assignmentId: string;
      courseId: string;
      allowedLanguages: Language[];
      backLink: { href: string; type: "assignment" };
      problemInScope: boolean;
    };

export interface ProblemSolvePropsShape {
  allowedLanguages: Language[];
  assignmentProp:
    | {
        assessmentId: string;
        courseId: string;
      }
    | undefined;
  backLink: { href: string; type: "assignment" | "contest" } | undefined;
  canRejudge: boolean;
  contestId: string | undefined;
  problem: Awaited<ReturnType<typeof getProblemPageData>>;
  submissions: Awaited<ReturnType<typeof listProblemSubmissions>>;
  testcaseSets: {
    id: string;
    name: string;
    description: string;
    weight: number;
    ordinal: number;
    caseCount: number;
  }[];
}

export async function loadProblemSolveData(
  problemId: string,
  actor: ActorContext,
  context: ProblemSolveContext,
): Promise<ProblemSolvePropsShape> {
  const [problemRow, problem] = await Promise.all([
    getProblemRowById(problemId),
    getProblemPageData(problemId),
  ]);

  if (!problemRow) {
    error(404, "Problem not found");
  }

  await assertProblemViewAccess(
    {
      id: problemRow.id,
      authorId: problemRow.authorId,
      visibility: problemRow.visibility,
    },
    {
      userId: actor.userId,
      username: actor.username ?? "",
      platformRole: actor.platformRole,
    },
    { contextIncludesProblem: context.problemInScope },
  );

  const assignmentProp =
    context.kind === "assignment" || context.kind === "exam"
      ? { assessmentId: context.assignmentId, courseId: context.courseId }
      : undefined;

  const contestId = context.kind === "contest" ? context.contestId : undefined;

  const [fullTestcaseSets, submissions, canRejudge] = await Promise.all([
    getProblemTestcaseSets(problemId),
    listProblemSubmissions(
      actor.userId,
      problemId,
      context.kind === "assignment" || context.kind === "exam"
        ? { assignmentId: context.assignmentId, courseId: context.courseId }
        : undefined,
    ),
    canOperateOnSubmission(
      {
        userId: actor.userId,
        username: actor.username ?? "",
        displayName: actor.displayName,
        email: actor.email,
        platformRole: actor.platformRole,
      },
      {
        id: "",
        userId: actor.userId,
        problemId,
        contestId: context.kind === "contest" ? context.contestId : null,
        courseAssessmentId: context.kind === "assignment" ? context.assignmentId : null,
        examId: null,
      },
    ),
  ]);

  const testcaseSets = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length,
  }));

  return {
    allowedLanguages: context.allowedLanguages,
    assignmentProp,
    backLink: context.backLink,
    canRejudge,
    contestId,
    problem,
    submissions,
    testcaseSets,
  };
}
