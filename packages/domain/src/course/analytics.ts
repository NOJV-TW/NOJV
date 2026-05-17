import { assessmentRepo, courseMembershipRepo, submissionRepo } from "@nojv/db";

/**
 * Class-analytics dashboard aggregation.
 *
 * Everything here is derived from existing Submission / CourseAssessment data —
 * no new tables. Scope is the course's *published assignments*; drafts and exams
 * are excluded so unpublished homework and timed exams don't skew the picture.
 *
 * The route loader is responsible for the teacher/TA permission gate; this
 * function does not re-check authorization.
 */

/** Per-assessment class summary. */
export interface AssessmentSummary {
  assessmentId: string;
  title: string;
  problemCount: number;
  /** Active students in the course (constant across rows — kept here for convenience). */
  studentCount: number;
  /** Rounded mean of per-student total best-score across submitters. */
  avgScore: number;
  /**
   * Fraction (0-1) of active students who "completed" the assessment.
   * Completion = the student has an accepted submission on every problem in it.
   * An assessment with no problems is treated as 0.
   */
  completionRate: number;
}

/** A problem ranked by how hard it is — lowest AC rate first. */
export interface HardestProblem {
  problemId: string;
  /** Public, URL-facing problem number. */
  displayId: number;
  title: string;
  attempters: number;
  solvers: number;
  /** Fraction (0-1) of distinct attempters who got it accepted. */
  acRate: number;
}

/** A student the teacher should check on. */
export interface StudentAtRisk {
  userId: string;
  name: string;
  username: string | null;
  /** "no_submissions" = never submitted to a course assignment; "all_zero" = submitted but every best score is 0. */
  reason: "no_submissions" | "all_zero";
}

export interface VerdictDistributionEntry {
  status: string;
  count: number;
}

export interface CourseAnalytics {
  assessmentSummaries: AssessmentSummary[];
  hardestProblems: HardestProblem[];
  studentsAtRisk: StudentAtRisk[];
  verdictDistribution: VerdictDistributionEntry[];
  /** Active student count — surfaced so empty-state copy can distinguish "no students" from "no data". */
  studentCount: number;
  /** Published assignment count — distinguishes "no assignments" from "no submissions". */
  assessmentCount: number;
}

const HARDEST_PROBLEMS_LIMIT = 5;

export async function getCourseAnalytics(courseId: string): Promise<CourseAnalytics> {
  const [assessments, students] = await Promise.all([
    assessmentRepo.listPublishedWithProblemsByCourse(courseId),
    courseMembershipRepo.findStudents(courseId),
  ]);

  const studentCount = students.length;
  const assessmentIds = assessments.map((a) => a.id);

  if (assessmentIds.length === 0) {
    return {
      assessmentSummaries: [],
      hardestProblems: [],
      studentsAtRisk: students.map((s) => ({
        userId: s.userId,
        name: s.user.name,
        username: s.user.username,
        reason: "no_submissions" as const,
      })),
      verdictDistribution: [],
      studentCount,
      assessmentCount: 0,
    };
  }

  // Three batch queries — no per-assessment / per-problem N+1.
  const [scoreGroups, verdictGroups, problemStats] = await Promise.all([
    submissionRepo.groupBestScoresByAssessment(assessmentIds),
    submissionRepo.groupStatusByAssessments(assessmentIds),
    submissionRepo.countUserStatsByProblemForAssessments(assessmentIds),
  ]);

  // best score keyed `${assessmentId}::${userId}::${problemId}`
  const bestScore = new Map<string, number>();
  for (const g of scoreGroups) {
    const aid = g.courseAssessmentId;
    if (!aid) continue;
    bestScore.set(`${aid}::${g.userId}::${g.problemId}`, g._max.score ?? 0);
  }

  const assessmentSummaries = assessments.map((assessment) =>
    summarizeAssessment(assessment, students, bestScore),
  );

  const hardestProblems = rankHardestProblems(assessments, problemStats);

  const studentsAtRisk = findStudentsAtRisk(students, bestScore);

  const verdictDistribution = verdictGroups
    .map((g) => ({ status: g.status, count: g._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    assessmentSummaries,
    hardestProblems,
    studentsAtRisk,
    verdictDistribution,
    studentCount,
    assessmentCount: assessments.length,
  };
}

type AssessmentWithProblems = Awaited<
  ReturnType<typeof assessmentRepo.listPublishedWithProblemsByCourse>
>[number];
type StudentRow = Awaited<ReturnType<typeof courseMembershipRepo.findStudents>>[number];

function summarizeAssessment(
  assessment: AssessmentWithProblems,
  students: StudentRow[],
  bestScore: Map<string, number>,
): AssessmentSummary {
  const problemIds = assessment.problems.map((p) => p.problem.id);

  let scoreSum = 0;
  let submitterCount = 0;
  let completedCount = 0;

  for (const student of students) {
    let total = 0;
    let attempted = false;
    let completedAll = problemIds.length > 0;

    for (const problemId of problemIds) {
      const score = bestScore.get(`${assessment.id}::${student.userId}::${problemId}`);
      if (score === undefined) {
        completedAll = false;
        continue;
      }
      attempted = true;
      total += score;
      // "Completed a problem" = an accepted submission on it. The best-score
      // map only reflects scores, so we treat a problem as solved when the
      // student reached its full point value.
      if (score < (problemPoints(assessment, problemId) ?? Infinity)) {
        completedAll = false;
      }
    }

    if (attempted) {
      scoreSum += total;
      submitterCount += 1;
    }
    if (completedAll) completedCount += 1;
  }

  return {
    assessmentId: assessment.id,
    title: assessment.title,
    problemCount: assessment.problems.length,
    studentCount: students.length,
    avgScore: submitterCount === 0 ? 0 : Math.round(scoreSum / submitterCount),
    completionRate: students.length === 0 ? 0 : completedCount / students.length,
  };
}

function problemPoints(
  assessment: AssessmentWithProblems,
  problemId: string,
): number | undefined {
  return assessment.problems.find((p) => p.problem.id === problemId)?.points;
}

function rankHardestProblems(
  assessments: AssessmentWithProblems[],
  problemStats: { problemId: string; attempters: number; solvers: number }[],
): HardestProblem[] {
  // Same problem can be linked to several assessments — dedupe to first occurrence.
  const problemMeta = new Map<string, { displayId: number; title: string }>();
  for (const assessment of assessments) {
    for (const link of assessment.problems) {
      if (!problemMeta.has(link.problem.id)) {
        problemMeta.set(link.problem.id, {
          displayId: link.problem.displayId,
          title: link.problem.title,
        });
      }
    }
  }

  return problemStats
    .flatMap((s): HardestProblem[] => {
      const meta = problemMeta.get(s.problemId);
      // No attempters can't have an AC rate; unknown problem = stat row for a
      // problem since unlinked from the course.
      if (s.attempters === 0 || !meta) return [];
      return [
        {
          problemId: s.problemId,
          displayId: meta.displayId,
          title: meta.title,
          attempters: s.attempters,
          solvers: s.solvers,
          acRate: s.solvers / s.attempters,
        },
      ];
    })
    .sort((a, b) => a.acRate - b.acRate || b.attempters - a.attempters)
    .slice(0, HARDEST_PROBLEMS_LIMIT);
}

function findStudentsAtRisk(
  students: StudentRow[],
  bestScore: Map<string, number>,
): StudentAtRisk[] {
  // Per-student rollup of submission presence and max score across all assignments.
  const hasSubmission = new Set<string>();
  const maxScoreByUser = new Map<string, number>();
  for (const [key, score] of bestScore) {
    const userId = key.split("::")[1];
    if (!userId) continue;
    hasSubmission.add(userId);
    maxScoreByUser.set(userId, Math.max(maxScoreByUser.get(userId) ?? 0, score));
  }

  const atRisk: StudentAtRisk[] = [];
  for (const student of students) {
    if (!hasSubmission.has(student.userId)) {
      atRisk.push({
        userId: student.userId,
        name: student.user.name,
        username: student.user.username,
        reason: "no_submissions",
      });
    } else if ((maxScoreByUser.get(student.userId) ?? 0) === 0) {
      atRisk.push({
        userId: student.userId,
        name: student.user.name,
        username: student.user.username,
        reason: "all_zero",
      });
    }
  }
  return atRisk;
}
