import { examRepo, submissionRepo } from "@nojv/db";
import {
  submissionResultSchema,
  submissionVerdicts,
  type Language,
  type SubmissionResult,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getProblemPageData, getProblemTestcaseSets } from "../problem/queries";
import type { ProblemDetail } from "../problem/queries";
import { computeProblemTotalScore, getProblemTotalScores } from "../problem/total-score";
import {
  fallbackResultForRow,
  getVerdictDetail,
  narrowSubmissionRow,
} from "../submission/queries";
import { sanitizeStudentResult } from "../submission/scoring";

function letterForIndex(index: number): string {
  if (index < 0) return String(index + 1);
  if (index < 26) return String.fromCodePoint(65 + index);
  return String(index + 1);
}

export interface ExamProblemViewSibling {
  id: string;
  letter: string;
  title: string;
  bestScore?: number | undefined;
  maxScore: number;
  isActive: boolean;
  href: string;
}

export interface ExamProblemViewSubmission {
  id: string;
  language: Language;
  result: SubmissionResult;
  submittedAt: string;
  context: "exam";
}

export interface ExamProblemViewExam {
  id: string;
  courseId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface ExamProblemView {
  problem: ProblemDetail;
  submissions: ExamProblemViewSubmission[];
  siblingProblems: ExamProblemViewSibling[];
  exam: ExamProblemViewExam;
  examTitle: string;
  courseLabel: string;
}

export async function getExamProblemView(options: {
  examId: string;
  problemIdx: number;
  actorUserId: string;
}): Promise<ExamProblemView | null> {
  const exam = await examRepo.findDetailById(options.examId);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${options.examId}`);
  }

  const problems = exam.problems;
  if (options.problemIdx < 0 || options.problemIdx >= problems.length) {
    return null;
  }

  const current = problems[options.problemIdx];
  if (!current) return null;

  const problemIds = problems.map((ep) => ep.problem.id);

  const [problem, submissionRows, bestRows, testcaseSets] = await Promise.all([
    getProblemPageData(current.problem.id),
    submissionRepo.findMany({
      where: {
        examId: options.examId,
        userId: options.actorUserId,
        problemId: current.problem.id,
        sampleOnly: false,
        status: { in: [...submissionVerdicts] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        status: true,
        verdictDetailStorageKey: true,
      },
      take: 50,
    }),
    submissionRepo.groupByUserAndProblem({
      examId: options.examId,
      userId: options.actorUserId,
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
    getProblemTestcaseSets(current.problem.id),
  ]);

  const problemTotal = computeProblemTotalScore({
    type: problem.type,
    testcaseSets,
    advancedConfig: problem.advancedConfig,
  });

  const detailBlobs = await Promise.all(
    submissionRows.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s, idx) => {
    const { verdict, language } = narrowSubmissionRow(s);
    const raw = detailBlobs[idx];
    const parsed = raw == null ? null : submissionResultSchema.safeParse(raw);
    const result = parsed?.success
      ? sanitizeStudentResult(parsed.data, { sampleOnly: false })
      : fallbackResultForRow(verdict, problemTotal);
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
      context: "exam" as const,
    };
  });

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  const maxByProblem = await getProblemTotalScores(problemIds);

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: letterForIndex(index),
    title: ep.problem.title,
    bestScore: bestByProblemId.get(ep.problem.id),
    maxScore: maxByProblem.get(ep.problem.id) ?? ep.points,
    isActive: index === options.problemIdx,
    href: `/exams/${exam.id}/problems/${String(index)}`,
  }));

  return {
    problem,
    submissions,
    siblingProblems,
    exam: {
      id: exam.id,
      courseId: exam.courseId,
      title: exam.title,
      startsAt: exam.startsAt.toISOString(),
      endsAt: exam.endsAt.toISOString(),
    },
    examTitle: exam.title,
    courseLabel: exam.course.title,
  };
}

export async function getExamProblemViewByProblemId(options: {
  examId: string;
  problemId: string;
  actorUserId: string;
}): Promise<ExamProblemView | null> {
  const exam = await examRepo.findDetailById(options.examId);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${options.examId}`);
  }

  const problems = exam.problems;
  const activeIdx = problems.findIndex((ep) => ep.problem.id === options.problemId);
  if (activeIdx === -1) return null;

  const current = problems[activeIdx];
  if (!current) return null;

  const problemIds = problems.map((ep) => ep.problem.id);

  const [problem, submissionRows, bestRows, testcaseSets] = await Promise.all([
    getProblemPageData(current.problem.id),
    submissionRepo.findMany({
      where: {
        examId: options.examId,
        userId: options.actorUserId,
        problemId: current.problem.id,
        sampleOnly: false,
        status: { in: [...submissionVerdicts] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        status: true,
        verdictDetailStorageKey: true,
      },
      take: 50,
    }),
    submissionRepo.groupByUserAndProblem({
      examId: options.examId,
      userId: options.actorUserId,
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
    getProblemTestcaseSets(current.problem.id),
  ]);

  const problemTotal = computeProblemTotalScore({
    type: problem.type,
    testcaseSets,
    advancedConfig: problem.advancedConfig,
  });

  const detailBlobs = await Promise.all(
    submissionRows.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s, idx) => {
    const { verdict, language } = narrowSubmissionRow(s);
    const raw = detailBlobs[idx];
    const parsed = raw == null ? null : submissionResultSchema.safeParse(raw);
    const result = parsed?.success
      ? sanitizeStudentResult(parsed.data, { sampleOnly: false })
      : fallbackResultForRow(verdict, problemTotal);
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString(),
      context: "exam" as const,
    };
  });

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  const maxByProblem = await getProblemTotalScores(problemIds);

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: letterForIndex(index),
    title: ep.problem.title,
    bestScore: bestByProblemId.get(ep.problem.id),
    maxScore: maxByProblem.get(ep.problem.id) ?? ep.points,
    isActive: index === activeIdx,
    href: `/exams/${exam.id}/problems/${ep.problem.id}`,
  }));

  return {
    problem,
    submissions,
    siblingProblems,
    exam: {
      id: exam.id,
      courseId: exam.courseId,
      title: exam.title,
      startsAt: exam.startsAt.toISOString(),
      endsAt: exam.endsAt.toISOString(),
    },
    examTitle: exam.title,
    courseLabel: exam.course.title,
  };
}
