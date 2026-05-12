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

/**
 * Per-family scope that bounds a student's view of a problem.
 *
 * Loaders in the new family-scoped route trees (assignment / contest / exam)
 * call `loadProblemSolveData` with the context their `+layout.server.ts`
 * already verified — enrollment, time window, and membership have all been
 * checked upstream. This helper only needs to confirm the problem itself is
 * visible to the viewer and return the uniform `solveProps` shape that
 * `<ProblemSolveView>` consumes.
 *
 * `assignment` is the assignment-shell variant.  `contest` and `exam` hooks
 * are stubbed for the parallel agents working on those trees — they can
 * extend this type without breaking the assignment flow.
 */
export type ProblemSolveContext =
  | {
      kind: "assignment";
      assignmentId: string;
      courseId: string;
      allowedLanguages: Language[];
      /** Link shown on the solve-page header to return to the shell. */
      backLink: { href: string; type: "assignment" };
      /** Already verified by the shell layout — `exists(assignmentId, problemId)`. */
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
  /**
   * Shape mirrors `assessmentContextSchema` (core wire-format) so it flows
   * directly into ProblemSolveView's `assessment` prop. Keeping the
   * `assessmentId` field name matches the schema.
   */
  assignmentProp:
    | {
        assessmentId: string;
        courseId: string;
      }
    | undefined;
  backLink: { href: string; type: "assignment" | "contest" } | undefined;
  /** Whether the viewer may rejudge submissions in this context. */
  canRejudge: boolean;
  contestId: string | undefined;
  problem: Awaited<ReturnType<typeof getProblemPageData>>;
  submissions: Awaited<ReturnType<typeof listProblemSubmissions>>;
  // `description` is non-null in the DB (default ""), so we match the
  // `ProblemTestcaseSetSummary` shape expected by the UI.
  testcaseSets: {
    id: string;
    name: string;
    description: string;
    weight: number;
    ordinal: number;
    caseCount: number;
  }[];
}

/**
 * Load the uniform `solveProps` bundle that `<ProblemSolveView>` expects.
 *
 * The caller's `+layout.server.ts` is responsible for membership / time-window
 * checks; this helper only runs the problem-row-level access check and then
 * fetches the display payload in parallel.
 */
export async function loadProblemSolveData(
  problemId: string,
  actor: ActorContext,
  context: ProblemSolveContext,
): Promise<ProblemSolvePropsShape> {
  // `getProblemPageData` returns the UI-facing `ProblemDetail` which does not
  // carry `authorId`.  We fetch the row separately to run the view-access
  // check; the two calls hit different tables so running them in parallel
  // is a small win.
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

  const fullTestcaseSets = await getProblemTestcaseSets(problemId);
  const testcaseSets = fullTestcaseSets.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    weight: set.weight,
    ordinal: set.ordinal,
    caseCount: set.testcases.length,
  }));

  const assignmentProp =
    context.kind === "assignment" || context.kind === "exam"
      ? { assessmentId: context.assignmentId, courseId: context.courseId }
      : undefined;

  const contestId = context.kind === "contest" ? context.contestId : undefined;

  // Submissions are always scoped to the shell's context so that
  // a student's assignment submissions don't leak into a contest view
  // (and vice-versa).
  const submissions = await listProblemSubmissions(
    actor.userId,
    problemId,
    context.kind === "assignment" || context.kind === "exam"
      ? { assignmentId: context.assignmentId, courseId: context.courseId }
      : undefined,
  );

  // Submissions listed here all share the same context, so the rejudge
  // authz decision is homogeneous — compute once. The synthetic submission
  // only needs the context fields; id/userId do not affect the check.
  const canRejudge = await canOperateOnSubmission(
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
  );

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
