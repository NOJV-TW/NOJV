import { examRepo, submissionRepo } from "@nojv/db";
import {
  submissionVerdicts,
  verdictSummarySchema,
  type Language,
  type SubmissionResult,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { problemLetter } from "../shared/problem-letter";
import { getProblemPageData } from "../problem/queries";
import type { ProblemDetail } from "../problem/queries";
import { getProblemTotalScores } from "../problem/total-score";
import { narrowSubmissionRow } from "../submission/queries";

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
  const problemId = exam.problems[options.problemIdx]?.problem.id;
  if (problemId === undefined) return null;
  return getExamProblemViewByProblemId({
    examId: options.examId,
    problemId,
    actorUserId: options.actorUserId,
  });
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

  const [problem, submissionRows, bestRows] = await Promise.all([
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
        score: true,
        runtimeMs: true,
        verdictSummary: true,
      },
      take: 50,
    }),
    submissionRepo.groupByUserAndProblem({
      examId: options.examId,
      userId: options.actorUserId,
      problemId: { in: problemIds },
      sampleOnly: false,
    }),
  ]);

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s) => {
    const { verdict, language } = narrowSubmissionRow(s);
    const parsedSummary =
      s.verdictSummary == null ? null : verdictSummarySchema.safeParse(s.verdictSummary);
    const summary = parsedSummary?.success ? parsedSummary.data : null;
    const result: SubmissionResult = {
      accepted: verdict === "accepted",
      verdict,
      score: s.score,
      runtimeMs: s.runtimeMs ?? 0,
      feedback:
        summary?.compilerErrorTruncated ??
        (verdict === "accepted" ? "Accepted." : "Verdict details unavailable."),
    };
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
    letter: problemLetter(index + 1),
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
