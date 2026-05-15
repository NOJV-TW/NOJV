import { contestRepo, submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import { NotFoundError } from "../shared/errors";

export type UpsolveStatus = "solved" | "attempted" | "untouched";

export interface UpsolveProblem {
  problemId: string;
  /** Contest-local letter (A, B, ...) derived from the problem's ordinal. */
  letter: string;
  ordinal: number;
  points: number;
  title: string;
  status: UpsolveStatus;
}

export interface UpsolveView {
  contestId: string;
  title: string;
  endsAt: string;
  problems: UpsolveProblem[];
}

/**
 * Post-contest practice index.
 *
 * Status is derived from the user's submissions across ALL contexts (not just
 * practice / not just this contest): an AC anywhere on the problem counts as
 * `solved`. v1 is a navigation aid, so a broad "have you ever solved this"
 * signal is the most useful and least surprising — a student who solved the
 * problem during the live contest shouldn't be told to upsolve it.
 * `sampleOnly` runs are excluded — they aren't real attempts.
 *
 * Throws `NotFoundError` when the contest is missing, unpublished, or has not
 * yet ended (now < endsAt) — the upsolve index must not leak before the close.
 */
export async function getUpsolveView(
  contestId: string,
  userId: string,
  now: Date = new Date(),
): Promise<UpsolveView> {
  const contest = await contestRepo.findDetailById(contestId);
  if (contest?.visibility !== "published") {
    throw new NotFoundError(`Contest not found: ${contestId}`);
  }
  if (now < contest.endsAt) {
    throw new NotFoundError(`Contest has not ended yet: ${contestId}`);
  }

  const problemIds = contest.problems.map((cp) => cp.problem.id);

  // Two batch queries, no N+1: one grouping the user's accepted submissions
  // (→ solved), one grouping all real attempts (→ attempted vs untouched).
  const [acceptedRows, attemptRows] =
    problemIds.length === 0
      ? [[], []]
      : await Promise.all([
          submissionRepo.groupByUserAndProblem({
            userId,
            problemId: { in: problemIds },
            sampleOnly: false,
            status: "accepted",
          }),
          submissionRepo.groupByUserAndProblem({
            userId,
            problemId: { in: problemIds },
            sampleOnly: false,
          }),
        ]);

  const solvedProblemIds = new Set(acceptedRows.map((r) => r.problemId));
  const attemptedProblemIds = new Set(attemptRows.map((r) => r.problemId));

  const problems: UpsolveProblem[] = contest.problems.map((cp) => {
    const problemId = cp.problem.id;
    const status: UpsolveStatus = solvedProblemIds.has(problemId)
      ? "solved"
      : attemptedProblemIds.has(problemId)
        ? "attempted"
        : "untouched";
    return {
      problemId,
      letter: problemLetter(cp.ordinal),
      ordinal: cp.ordinal,
      points: cp.points,
      title: cp.problem.title,
      status,
    };
  });

  return {
    contestId: contest.id,
    title: contest.title,
    endsAt: contest.endsAt.toISOString(),
    problems,
  };
}
