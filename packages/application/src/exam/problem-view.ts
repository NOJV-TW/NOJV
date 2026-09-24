import { toProblemSubmissionEntry } from "../submission/history";
import { applyQueuedRejudges } from "../submission/operations";
import { activityScore } from "../scoring/activity-points";
import { scoreOverrideRepo } from "@nojv/db";
import { examRepo, submissionRepo } from "@nojv/db";
import {
  problemLetter,
  extractLatePenalty,
  type LatePenaltyRule,
  submissionOperationStatuses,
} from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import { getProblemPageData } from "../problem/details";
import type { ProblemDetail } from "../problem/details";
import { getProblemTotalScores, requireProblemTotalScore } from "../problem/total-score";

export interface ExamProblemViewSibling {
  id: string;
  letter: string;
  title: string;
  bestScore?: number | undefined;
  maxScore: number;
  rawBestScore?: number | undefined;
  rawMaxScore: number;
  isActive: boolean;
  href: string;
}

export type ExamProblemViewSubmission = ReturnType<typeof toProblemSubmissionEntry> & {
  context: "exam";
};

export interface ExamProblemViewExam {
  id: string;
  courseId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  dueAt: string | null;
  latePenalty: LatePenaltyRule | null;
}

export interface ExamProblemView {
  problem: ProblemDetail;
  submissions: ExamProblemViewSubmission[];
  siblingProblems: ExamProblemViewSibling[];
  exam: ExamProblemViewExam;
  examTitle: string;
  courseLabel: string;
}

// intentional-nullable: An invalid problem index is treated as an absent exam problem.
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

// intentional-nullable: A problem outside the published exam is treated as not-found.
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
        status: { in: [...submissionOperationStatuses] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        judgeGeneration: true,
        contestId: true,
        assessmentId: true,
        examId: true,
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
      createdAt: { lt: exam.endsAt },
    }),
  ]);

  const submissions: ExamProblemViewSubmission[] = (
    await applyQueuedRejudges(submissionRows)
  ).map((row) => ({ ...toProblemSubmissionEntry(row), context: "exam" }));

  const bestByProblemId = new Map<string, number>();
  for (const row of bestRows) {
    if (row._max.score !== null) {
      bestByProblemId.set(row.problemId, row._max.score);
    }
  }

  const maxByProblem = await getProblemTotalScores(problemIds);
  const overrides = await scoreOverrideRepo.findForExamUser(
    options.examId,
    options.actorUserId,
  );
  for (const override of overrides)
    bestByProblemId.set(override.problemId, override.overrideScore);

  const siblingProblems: ExamProblemViewSibling[] = problems.map((ep, index) => ({
    id: ep.problem.id,
    letter: problemLetter(index + 1),
    title: ep.problem.title,
    bestScore: bestByProblemId.has(ep.problem.id)
      ? activityScore(
          bestByProblemId.get(ep.problem.id) ?? 0,
          requireProblemTotalScore(maxByProblem, ep.problem.id),
          ep.points,
        ).toNumber()
      : undefined,
    rawBestScore: bestByProblemId.get(ep.problem.id),
    rawMaxScore: requireProblemTotalScore(maxByProblem, ep.problem.id),
    maxScore: Number(ep.points),
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
      dueAt: exam.dueAt?.toISOString() ?? null,
      latePenalty: extractLatePenalty(exam.adjustmentRules),
    },
    examTitle: exam.title,
    courseLabel: exam.course.title,
  };
}
