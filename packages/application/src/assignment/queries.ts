import { activityScore, sumActivityScores } from "../scoring/activity-points";
import {
  assessmentProblemRepo,
  assessmentRepo,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import { problemLetter, submissionVerdicts } from "@nojv/core";

import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";

export async function getAssignmentWithCourseId(assignmentId: string) {
  return assessmentRepo.findByIdWithCourseId(assignmentId);
}

export async function isProblemInAssignment(
  assignmentId: string,
  problemId: string,
): Promise<boolean> {
  return assessmentProblemRepo.exists(assignmentId, problemId);
}

export interface AssignmentProblemSibling {
  id: string;
  letter: string;
  title: string;
  bestScore?: number | undefined;
  maxScore: number;
  rawBestScore?: number | undefined;
  rawMaxScore: number;
  isActive: boolean;
  href: string;
}

export async function listAssignmentProblemSiblings(options: {
  assignmentId: string;
  activeProblemId: string;
  actorUserId: string;
}): Promise<AssignmentProblemSibling[]> {
  const rows = await assessmentProblemRepo.findByAssessmentId(options.assignmentId);
  if (rows.length === 0) return [];

  const ordered = rows.slice().sort((a, b) => a.ordinal - b.ordinal);
  const problemIds = ordered.map((r) => r.problemId);

  const bestRows = await submissionRepo.groupByUserAndProblem({
    assessmentId: options.assignmentId,
    userId: options.actorUserId,
    problemId: { in: problemIds },
    sampleOnly: false,
    status: { in: [...submissionVerdicts] },
  });

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  const maxByProblem = await getProblemTotalScores(problemIds);
  const overrides = await scoreOverrideRepo.findCourseOverrides(
    "assignment",
    [options.assignmentId],
    options.actorUserId,
  );
  for (const override of overrides)
    bestByProblemId.set(override.problemId, override.overrideScore);

  return ordered.map((r, index) => ({
    id: r.problemId,
    letter: problemLetter(index + 1),
    title: r.problem.title,
    bestScore: bestByProblemId.has(r.problemId)
      ? activityScore(
          bestByProblemId.get(r.problemId) ?? 0,
          requireProblemTotalScore(maxByProblem, r.problemId),
          r.points,
        ).toNumber()
      : undefined,
    rawBestScore: bestByProblemId.get(r.problemId),
    rawMaxScore: requireProblemTotalScore(maxByProblem, r.problemId),
    maxScore: Number(r.points),
    isActive: r.problemId === options.activeProblemId,
    href: `/assignments/${options.assignmentId}/problems/${r.problemId}`,
  }));
}

export async function listStudentsBelowMaxScore(
  assignmentId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const problems = await assessmentProblemRepo.findByAssessmentId(assignmentId);
  if (problems.length === 0) return userIds;

  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return userIds;
  const maxByProblem = await getProblemTotalScores(problems.map((p) => p.problemId));
  const grouped = await submissionRepo.groupByUserAndProblem({
    assessmentId: assignmentId,
    userId: { in: userIds },
    problemId: { in: problems.map((p) => p.problemId) },
    sampleOnly: false,

    status: { in: [...submissionVerdicts] },
  });
  const scores = new Map(
    grouped.map((row) => [`${row.userId}::${row.problemId}`, row._max.score ?? 0]),
  );
  const overrides = await scoreOverrideRepo.findCourseOverrides("assignment", [assignmentId]);
  for (const override of overrides) {
    const userId = override.membership?.userId;
    if (userId) scores.set(`${userId}::${override.problemId}`, override.overrideScore);
  }
  return userIds.filter(
    (userId) =>
      sumActivityScores(
        problems.map((problem) =>
          activityScore(
            scores.get(`${userId}::${problem.problemId}`) ?? 0,
            requireProblemTotalScore(maxByProblem, problem.problemId),
            problem.points,
          ),
        ),
      ) < Number(assignment.totalPoints),
  );
}
