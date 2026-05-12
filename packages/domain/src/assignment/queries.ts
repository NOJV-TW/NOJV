import { assessmentProblemRepo, assessmentRepo, submissionRepo } from "@nojv/db";
import { submissionVerdicts } from "@nojv/core";

/**
 * Load the assignment row with its course id, used by shell loaders to
 * derive the `courseId` for the URL params. Returns null when missing;
 * callers surface that as a 404.
 */
export async function getAssignmentWithCourseId(assignmentId: string) {
  return assessmentRepo.findByIdWithCourseId(assignmentId);
}

/**
 * Existence check for an assignment-problem attach row. Used by the
 * assignment problem-solve loader so we don't leak whether the problem
 * exists outside the assignment scope.
 */
export async function isProblemInAssignment(
  assignmentId: string,
  problemId: string,
): Promise<boolean> {
  return assessmentProblemRepo.exists(assignmentId, problemId);
}

export interface AssignmentInfo {
  closesAt: string;
  /** Nullable: assignments without a soft deadline have no late penalty. */
  dueAt: string | null;
  opensAt: string;
}

export async function getAssignmentInfo(assignmentId: string): Promise<AssignmentInfo> {
  const assignment = await assessmentRepo.findInfoById(assignmentId);

  return {
    closesAt: assignment.closesAt.toISOString(),
    dueAt: assignment.dueAt?.toISOString() ?? null,
    opensAt: assignment.opensAt.toISOString(),
  };
}

export interface AssignmentProblemSibling {
  id: string;
  letter: string;
  title: string;
  bestScore?: number | undefined;
  maxScore: number;
  isActive: boolean;
  href: string;
}

function letterForIndex(index: number): string {
  if (index < 0) return String(index + 1);
  if (index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

/**
 * Build the assignment's sibling-problem list for the float problem switcher.
 * Submission filter is scoped by (assignmentId, userId, problemId) — cross-
 * assignment data cannot leak through.
 */
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
    courseAssessmentId: options.assignmentId,
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

  return ordered.map((r, index) => ({
    id: r.problemId,
    letter: letterForIndex(index),
    title: r.problem.title,
    bestScore: bestByProblemId.get(r.problemId),
    maxScore: r.points,
    isActive: r.problemId === options.activeProblemId,
    href: `/assignments/${options.assignmentId}/problems/${r.problemId}`,
  }));
}

/**
 * Given a candidate set of user ids, return those whose summed best score
 * across the assignment's attached problems is strictly less than the
 * assignment total. Used by the 24h deadline fan-out to skip students who
 * have already maxed out — no point reminding them.
 *
 * Returns the input `userIds` unchanged when there are no attached problems
 * or no max score to compare against (nothing to max out → everyone qualifies).
 */
export async function listStudentsBelowMaxScore(
  assignmentId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const problems = await assessmentProblemRepo.findByAssessmentId(assignmentId);
  if (problems.length === 0) return userIds;

  const pointsByProblem = new Map(problems.map((p) => [p.problemId, p.points]));
  const totalMax = problems.reduce((sum, p) => sum + p.points, 0);
  if (totalMax === 0) return userIds;

  const grouped = await submissionRepo.groupBestScores({
    assessmentId: assignmentId,
    studentIds: userIds,
    problemIds: problems.map((p) => p.problemId),
  });

  const sumByUser = new Map<string, number>();
  for (const row of grouped) {
    const maxPts = pointsByProblem.get(row.problemId);
    if (maxPts == null) continue;
    const best = Math.min(row._max.score ?? 0, maxPts);
    sumByUser.set(row.userId, (sumByUser.get(row.userId) ?? 0) + best);
  }

  return userIds.filter((id) => (sumByUser.get(id) ?? 0) < totalMax);
}
