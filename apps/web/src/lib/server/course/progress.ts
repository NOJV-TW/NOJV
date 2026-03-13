import { prisma } from "@nojv/db";

import { DEFAULT_LOCALE } from "$lib/utils";
import { pickProblemStatement } from "../shared/pick-problem-statement";

// ─── Types ───────────────────────────────────────────────────────────

export interface StudentProblemScore {
  bestScore: number;
  bestVerdict: string;
  submissionCount: number;
}

export interface ProgressStudent {
  userId: string;
  handle: string;
  name: string;
}

export interface ProgressProblem {
  problemId: string;
  slug: string;
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
  const course = await prisma.course.findUnique({
    where: { slug: courseSlug },
    select: { id: true }
  });

  if (!course) {
    return { students: [], problems: [], scores: {}, problemStats: {} };
  }

  // 1. Get active student memberships
  const memberships = await prisma.courseMembership.findMany({
    where: { courseId: course.id, role: "student", status: "active" },
    select: {
      userId: true,
      user: { select: { handle: true, name: true } }
    },
    orderBy: { user: { handle: "asc" } }
  });

  const students: ProgressStudent[] = memberships.map((m) => ({
    userId: m.userId,
    handle: m.user.handle ?? m.user.name,
    name: m.user.name
  }));

  const studentIds = new Set(students.map((s) => s.userId));

  // 2. Get problems (all course problems or assessment-specific)
  let assessmentId: string | undefined;
  let problemRecords: ProgressProblem[];

  if (assessmentSlug) {
    const assessment = await prisma.courseAssessment.findFirst({
      where: { courseId: course.id, slug: assessmentSlug, status: "published" },
      select: {
        id: true,
        problems: {
          select: {
            problemId: true,
            problem: { select: { id: true, slug: true, summary: true, statements: true } }
          },
          orderBy: { ordinal: "asc" }
        }
      }
    });

    if (!assessment) {
      return { students, problems: [], scores: {}, problemStats: {} };
    }

    assessmentId = assessment.id;
    problemRecords = assessment.problems.map((p) => {
      const localized = pickProblemStatement(
        p.problem.statements,
        DEFAULT_LOCALE,
        p.problem.slug,
        p.problem.summary
      );
      return { problemId: p.problem.id, slug: p.problem.slug, title: localized.title };
    });
  } else {
    const courseProblems = await prisma.courseProblem.findMany({
      where: { courseId: course.id },
      select: {
        problem: { select: { id: true, slug: true, summary: true, statements: true } }
      },
      orderBy: { createdAt: "asc" }
    });

    problemRecords = courseProblems.map((cp) => {
      const localized = pickProblemStatement(
        cp.problem.statements,
        DEFAULT_LOCALE,
        cp.problem.slug,
        cp.problem.summary
      );
      return { problemId: cp.problem.id, slug: cp.problem.slug, title: localized.title };
    });
  }

  const problemIds = problemRecords.map((p) => p.problemId);

  if (students.length === 0 || problemIds.length === 0) {
    return { students, problems: problemRecords, scores: {}, problemStats: {} };
  }

  // 3. Query best scores per (userId, problemId)
  const submissionFilter: Parameters<typeof prisma.submission.groupBy>[0]["where"] = {
    courseId: course.id,
    sampleOnly: false,
    userId: { in: [...studentIds] },
    problemId: { in: problemIds },
    ...(assessmentId ? { courseAssessmentId: assessmentId } : {})
  };

  const grouped = await prisma.submission.groupBy({
    by: ["userId", "problemId"],
    where: submissionFilter,
    _max: { score: true },
    _count: { id: true }
  });

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

  // Batch-fetch the verdict for the best submission of each pair
  if (pairsNeedingVerdict.length > 0) {
    const verdictResults = await Promise.all(
      pairsNeedingVerdict.map((pair) =>
        prisma.submission.findFirst({
          where: {
            courseId: course.id,
            sampleOnly: false,
            userId: pair.userId,
            problemId: pair.problemId,
            score: pair.bestScore,
            ...(assessmentId ? { courseAssessmentId: assessmentId } : {})
          },
          select: { status: true },
          orderBy: { createdAt: "desc" }
        })
      )
    );

    for (let i = 0; i < pairsNeedingVerdict.length; i++) {
      const pair = pairsNeedingVerdict[i]!;
      const key = `${pair.userId}:${pair.problemId}`;
      scores[key]!.bestVerdict = verdictResults[i]?.status ?? "";
    }
  }

  // 5. Compute per-problem stats
  const totalStudents = students.length;
  const problemStats: Record<string, { acCount: number; totalStudents: number }> = {};

  for (const problem of problemRecords) {
    let acCount = 0;
    for (const student of students) {
      const entry = scores[`${student.userId}:${problem.problemId}`];
      if (entry && entry.bestVerdict === "accepted") {
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
