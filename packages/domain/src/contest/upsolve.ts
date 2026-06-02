import { contestRepo, submissionRepo } from "@nojv/db";

import { problemLetter } from "../shared/problem-letter";
import { NotFoundError } from "../shared/errors";

export type UpsolveStatus = "solved" | "attempted" | "untouched";

export interface UpsolveProblem {
  problemId: string;
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

  const resolveStatus = (problemId: string): UpsolveStatus => {
    if (solvedProblemIds.has(problemId)) return "solved";
    if (attemptedProblemIds.has(problemId)) return "attempted";
    return "untouched";
  };

  const problems: UpsolveProblem[] = contest.problems.map((cp) => {
    const problemId = cp.problem.id;
    const status: UpsolveStatus = resolveStatus(problemId);
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
