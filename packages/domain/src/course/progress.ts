import {
  assessmentRepo,
  courseMembershipRepo,
  courseProblemRepo,
  courseRepo,
  submissionRepo
} from "@nojv/db";

import { localizeProblem } from "../shared/pick-problem-statement";

// ─── Types ───────────────────────────────────────────────────────────

export interface StudentProblemScore {
  bestScore: number;
  bestVerdict: string;
  submissionCount: number;
}

export interface ProgressStudent {
  userId: string;
  username: string;
  name: string;
}

export interface ProgressProblem {
  problemId: string;
  title: string;
}

export interface ProgressMatrix {
  students: ProgressStudent[];
  problems: ProgressProblem[];
  /** Key: `${userId}:${problemId}` */
  scores: Record<string, StudentProblemScore>;
  /** Key: problemId */
  problemStats: Record<string, { acCount: number; totalStudents: number }>;
}

// ─── Query ───────────────────────────────────────────────────────────

export async function getStudentProgressMatrix(
  courseSlug: string,
  assessmentSlug?: string
): Promise<ProgressMatrix> {
  const course = await courseRepo.findIdBySlug(courseSlug);

  if (!course) {
    return { students: [], problems: [], scores: {}, problemStats: {} };
  }

  // 1. Get active student memberships
  const memberships = await courseMembershipRepo.findStudents(course.id);

  const students: ProgressStudent[] = memberships.map((m) => ({
    userId: m.userId,
    username: m.user.username ?? m.user.name,
    name: m.user.name
  }));

  const studentIds = new Set(students.map((s) => s.userId));

  // 2. Get problems (all course problems or assessment-specific)
  let assessmentId: string | undefined;
  let problemRecords: ProgressProblem[];

  if (assessmentSlug) {
    const assessment = await assessmentRepo.findWithProblems(course.id, assessmentSlug);

    if (!assessment) {
      return { students, problems: [], scores: {}, problemStats: {} };
    }

    assessmentId = assessment.id;
    problemRecords = assessment.problems.map((p) => ({
      problemId: p.problem.id,
      title: localizeProblem(p.problem).title
    }));
  } else {
    const courseProblems = await courseProblemRepo.findByCourseId(course.id);
    problemRecords = courseProblems.map((cp) => ({
      problemId: cp.problem.id,
      title: localizeProblem(cp.problem).title
    }));
  }

  const problemIds = problemRecords.map((p) => p.problemId);

  if (students.length === 0 || problemIds.length === 0) {
    return { students, problems: problemRecords, scores: {}, problemStats: {} };
  }

  // 3. Query best scores per (userId, problemId)
  const submissionFilter = {
    courseId: course.id,
    sampleOnly: false,
    userId: { in: [...studentIds] },
    problemId: { in: problemIds },
    ...(assessmentId ? { courseAssessmentId: assessmentId } : {})
  };

  const grouped = await submissionRepo.groupByUserAndProblem(submissionFilter);

  // 4. For each (userId, problemId) pair, get the verdict of the best-scoring submission
  const scores: Record<string, StudentProblemScore> = {};

  // Collect pairs that need verdict lookup
  const pairsNeedingVerdict: { userId: string; problemId: string; bestScore: number }[] = [];

  for (const row of grouped) {
    const key = `${row.userId}:${row.problemId}`;
    const bestScore = row._max.score ?? 0;
    scores[key] = {
      bestScore,
      bestVerdict: "",
      submissionCount: row._count.id
    };
    pairsNeedingVerdict.push({ userId: row.userId, problemId: row.problemId, bestScore });
  }

  // Batch-fetch the verdict for the best submission of each pair using a single query
  if (pairsNeedingVerdict.length > 0) {
    const orConditions = pairsNeedingVerdict.map((pair) => ({
      userId: pair.userId,
      problemId: pair.problemId,
      score: pair.bestScore
    }));

    const bestSubmissions = await submissionRepo.findMany({
      where: {
        courseId: course.id,
        sampleOnly: false,
        ...(assessmentId ? { courseAssessmentId: assessmentId } : {}),
        OR: orConditions
      },
      select: { userId: true, problemId: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });

    // Pick the most recent submission per (userId, problemId) pair
    const verdictMap = new Map<string, string>();
    for (const sub of bestSubmissions) {
      const key = `${sub.userId}:${sub.problemId}`;
      if (!verdictMap.has(key)) {
        verdictMap.set(key, sub.status);
      }
    }

    for (const pair of pairsNeedingVerdict) {
      const key = `${pair.userId}:${pair.problemId}`;
      const scoreEntry = scores[key];
      if (scoreEntry) scoreEntry.bestVerdict = verdictMap.get(key) ?? "";
    }
  }

  // 5. Compute per-problem stats
  const totalStudents = students.length;
  const problemStats: Record<string, { acCount: number; totalStudents: number }> = {};

  for (const problem of problemRecords) {
    let acCount = 0;
    for (const student of students) {
      const entry = scores[`${student.userId}:${problem.problemId}`];
      if (entry?.bestVerdict === "accepted") {
        acCount++;
      }
    }
    problemStats[problem.problemId] = { acCount, totalStudents };
  }

  return {
    students,
    problems: problemRecords,
    scores,
    problemStats
  };
}
