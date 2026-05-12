import { assessmentProblemRepo, assessmentRepo, submissionRepo } from "@nojv/db";
import { submissionVerdicts } from "@nojv/core";

export * from "./mutations";

/**
 * Load the assessment row with its course id, used by shell loaders to
 * derive the `courseId` for the URL params. Returns null when missing;
 * callers surface that as a 404.
 */
export async function getAssessmentWithCourseId(assessmentId: string) {
  return assessmentRepo.findByIdWithCourseId(assessmentId);
}

/**
 * Existence check for an assessment-problem attach row. Used by the
 * assignment problem-solve loader so we don't leak whether the problem
 * exists outside the assignment scope.
 */
export async function isProblemInAssessment(
  assessmentId: string,
  problemId: string,
): Promise<boolean> {
  return assessmentProblemRepo.exists(assessmentId, problemId);
}

export interface AssessmentInfo {
  closesAt: string;
  /** Nullable: assessments without a soft deadline have no late penalty. */
  dueAt: string | null;
  opensAt: string;
}

export async function getAssessmentInfo(assessmentId: string): Promise<AssessmentInfo> {
  const assessment = await assessmentRepo.findInfoById(assessmentId);

  return {
    closesAt: assessment.closesAt.toISOString(),
    dueAt: assessment.dueAt?.toISOString() ?? null,
    opensAt: assessment.opensAt.toISOString(),
  };
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "published" });
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assessmentRepo.update(assessmentId, { status: "archived" });
}

export interface AssessmentProblemSibling {
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
 * Submission filter is scoped by (assessmentId, userId, problemId) — cross-
 * assignment data cannot leak through.
 */
export async function listAssessmentProblemSiblings(options: {
  assessmentId: string;
  activeProblemId: string;
  actorUserId: string;
}): Promise<AssessmentProblemSibling[]> {
  const rows = await assessmentProblemRepo.findByAssessmentId(options.assessmentId);
  if (rows.length === 0) return [];

  const ordered = rows.slice().sort((a, b) => a.ordinal - b.ordinal);
  const problemIds = ordered.map((r) => r.problemId);

  const bestRows = await submissionRepo.groupByUserAndProblem({
    courseAssessmentId: options.assessmentId,
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
    href: `/assignments/${options.assessmentId}/problems/${r.problemId}`,
  }));
}

/**
 * Given a candidate set of user ids, return those whose summed best score
 * across the assessment's attached problems is strictly less than the
 * assessment total. Used by the 24h deadline fan-out to skip students who
 * have already maxed out — no point reminding them.
 *
 * Returns the input `userIds` unchanged when there are no attached problems
 * or no max score to compare against (nothing to max out → everyone qualifies).
 */
export async function listStudentsBelowMaxScore(
  assessmentId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const problems = await assessmentProblemRepo.findByAssessmentId(assessmentId);
  if (problems.length === 0) return userIds;

  const pointsByProblem = new Map(problems.map((p) => [p.problemId, p.points]));
  const totalMax = problems.reduce((sum, p) => sum + p.points, 0);
  if (totalMax === 0) return userIds;

  const grouped = await submissionRepo.groupBestScores({
    assessmentId,
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
