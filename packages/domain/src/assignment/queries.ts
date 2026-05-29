import { assessmentProblemRepo, assessmentRepo, submissionRepo } from "@nojv/db";
import { submissionVerdicts } from "@nojv/core";

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
    letter: index < 26 ? String.fromCharCode(65 + index) : String(index + 1),
    title: r.problem.title,
    bestScore: bestByProblemId.get(r.problemId),
    maxScore: r.points,
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
