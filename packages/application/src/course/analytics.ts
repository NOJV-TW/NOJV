import { assessmentRepo, courseMembershipRepo, submissionRepo } from "@nojv/db";

import { getProblemTotalScores } from "../problem/total-score";

export interface AssessmentSummary {
  assessmentId: string;
  title: string;
  problemCount: number;
  studentCount: number;
  avgScore: number;
  completionRate: number;
}

export interface HardestProblem {
  problemId: string;
  displayId: number | null;
  title: string;
  attempters: number;
  solvers: number;
  acRate: number;
}

export interface StudentAtRisk {
  userId: string;
  name: string;
  username: string | null;
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
  studentCount: number;
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

  const [scoreGroups, verdictGroups, problemStats, maxByProblem] = await Promise.all([
    submissionRepo.groupBestScoresByAssessment(assessmentIds),
    submissionRepo.groupStatusByAssessments(assessmentIds),
    submissionRepo.countUserStatsByProblemForAssessments(assessmentIds),
    getProblemTotalScores(assessments.flatMap((a) => a.problems.map((p) => p.problem.id))),
  ]);

  const bestScore = new Map<string, number>();
  for (const g of scoreGroups) {
    const aid = g.assessmentId;
    if (!aid) continue;
    bestScore.set(`${aid}::${g.userId}::${g.problemId}`, g._max.score ?? 0);
  }

  const assessmentSummaries = assessments.map((assessment) =>
    summarizeAssessment(assessment, students, bestScore, maxByProblem),
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
  maxByProblem: Map<string, number>,
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
      if (score < (maxByProblem.get(problemId) ?? Infinity)) {
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

function rankHardestProblems(
  assessments: AssessmentWithProblems[],
  problemStats: { problemId: string; attempters: number; solvers: number }[],
): HardestProblem[] {
  const problemMeta = new Map<string, { displayId: number | null; title: string }>();
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
