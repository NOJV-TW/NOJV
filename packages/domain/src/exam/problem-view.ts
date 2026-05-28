import { examRepo, submissionRepo } from "@nojv/db";
import {
  languageSchema,
  submissionResultSchema,
  submissionVerdicts,
  submissionVerdictSchema,
  type Language,
  type SubmissionResult,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getProblemPageData } from "../problem/queries";
import type { ProblemDetail } from "../problem/queries";
import { fallbackResultForRow, getVerdictDetail } from "../submission/queries";
import { stripStaffFeedback } from "../submission/scoring";

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

// Submission filter is `(examId, userId, problemId)` — cross-exam data cannot leak through.
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
  ]);

  // Verdict detail lives in object storage; pull each row's blob in parallel.
  // The query already caps at 50 rows, so the fan-out is bounded.
  const detailBlobs = await Promise.all(
    submissionRows.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s, idx) => {
    // status is validated AND used as the fallback verdict when the detail
    // blob is missing/malformed.
    const verdict = submissionVerdictSchema.parse(s.status);
    // Detail blob may be absent (partial purge, read-after-write window) or
    // schema-invalid; degrade to a row-status-only summary instead of 500'ing
    // the whole list.
    const raw = detailBlobs[idx];
    const parsed = raw != null ? submissionResultSchema.safeParse(raw) : null;
    // User's own submissions in their own exam — never a staff viewer here.
    const result = parsed?.success
      ? stripStaffFeedback(parsed.data)
      : fallbackResultForRow(verdict);
    const language = languageSchema.parse(s.language);
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

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: letterForIndex(index),
    title: ep.problem.title,
    bestScore: bestByProblemId.get(ep.problem.id),
    maxScore: ep.points,
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

/**
 * CUID-unified variant of {@link getExamProblemView} — resolves by problem id
 * and emits sibling URLs under the new top-level `/exams/[examId]/problems/...`
 * tree.  Behavior-identical to `getExamProblemView` otherwise: same submission
 * scoping (examId, userId, problemId), same verdict/language parsing, same
 * best-score map.
 *
 * Returns `null` when the problem is not part of the exam so the loader can
 * `error(404, ...)` without leaking existence.
 */
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
  ]);

  // Verdict detail lives in object storage; pull each row's blob in parallel.
  const detailBlobs = await Promise.all(
    submissionRows.map((s) =>
      s.verdictDetailStorageKey ? getVerdictDetail(s.id) : Promise.resolve(null),
    ),
  );

  const submissions: ExamProblemViewSubmission[] = submissionRows.map((s, idx) => {
    // status is validated AND used as the fallback verdict when the detail
    // blob is missing/malformed.
    const verdict = submissionVerdictSchema.parse(s.status);
    // Detail blob may be absent (partial purge, read-after-write window) or
    // schema-invalid; degrade to a row-status-only summary instead of 500'ing
    // the whole list.
    const raw = detailBlobs[idx];
    const parsed = raw != null ? submissionResultSchema.safeParse(raw) : null;
    // User's own submissions in their own exam — never a staff viewer here.
    const result = parsed?.success
      ? stripStaffFeedback(parsed.data)
      : fallbackResultForRow(verdict);
    const language = languageSchema.parse(s.language);
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

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: letterForIndex(index),
    title: ep.problem.title,
    bestScore: bestByProblemId.get(ep.problem.id),
    maxScore: ep.points,
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
