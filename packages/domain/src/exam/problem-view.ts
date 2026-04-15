import { examRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type Language,
  type SubmissionResult
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getProblemPageData } from "../problem/queries";
import type { ProblemDetail } from "../problem/queries";

/**
 * Lettering helper — maps a 0-based ordinal to `A`, `B`, … `Z`, then
 * falls back to the raw ordinal for exams with more than 26 problems.
 */
function letterForIndex(index: number): string {
  if (index < 0) return String(index + 1);
  if (index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

export interface ExamProblemViewSibling {
  id: string;
  letter: string;
  title: string;
  /** Best score the current user has achieved within this exam. */
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
}

export interface ExamProblemViewExam {
  id: string;
  courseId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface ExamProblemView {
  /** Full problem-page payload — same shape the practice route uses. */
  problem: ProblemDetail;
  /** User's submissions, server-side scoped to (examId, problemId, userId). */
  submissions: ExamProblemViewSubmission[];
  /** All problems in the exam, in ordinal order, for the left rail. */
  siblingProblems: ExamProblemViewSibling[];
  exam: ExamProblemViewExam;
  examTitle: string;
  courseLabel: string;
}

/**
 * Loader helper for the exam-mode problem route.
 *
 * All three reads — exam metadata, problem page data, and
 * exam-scoped submission history — are batched into a single
 * round-trip so the loader stays under the 1-RTT budget. The
 * submission query filters on `(examId, userId, problemId)`; no
 * practice / contest / other-exam submissions can leak through.
 *
 * The helper also fetches per-sibling best scores (again scoped to
 * this exam + user) so the left rail can light up solved / partial
 * letters without a second call.
 */
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

  // Batched: full problem page, exam-scoped submissions for the
  // current problem, and per-problem best scores across the rest
  // of the exam (used by the sibling rail). All three are keyed
  // by (examId, userId) so cross-exam data cannot reach the page.
  const [problem, submissionRows, bestRows] = await Promise.all([
    getProblemPageData(current.problem.id),
    submissionRepo.findMany({
      where: {
        examId: options.examId,
        userId: options.actorUserId,
        problemId: current.problem.id,
        sampleOnly: false,
        status: { in: [...submissionVerdicts] }
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        language: true,
        status: true,
        verdictDetail: true
      },
      take: 50
    }),
    submissionRepo.groupByUserAndProblem({
      examId: options.examId,
      userId: options.actorUserId,
      problemId: { in: problemIds },
      sampleOnly: false
    })
  ]);

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s) => {
    submissionVerdictSchema.parse(s.status);
    const result = submissionResultSchema.parse(s.verdictDetail);
    const language = languageSchema.parse(s.language);
    return {
      id: s.id,
      language,
      result,
      submittedAt: s.createdAt.toISOString()
    };
  });

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: letterForIndex(index),
    title: ep.problem.title,
    bestScore: bestByProblemId.get(ep.problem.id),
    maxScore: ep.points,
    isActive: index === options.problemIdx,
    href: `/courses/${exam.courseId}/exams/${exam.id}/problems/${String(index)}`
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
      endsAt: exam.endsAt.toISOString()
    },
    examTitle: exam.title,
    courseLabel: exam.course.title
  };
}
