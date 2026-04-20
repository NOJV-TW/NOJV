import { assessmentProblemRepo, assessmentRepo, submissionRepo } from "@nojv/db";

export * from "./mutations";

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
