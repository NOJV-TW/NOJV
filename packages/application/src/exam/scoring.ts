import {
  examRepo,
  participationRepo,
  UnifiedParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import {
  buildScoreboard,
  runScoreUpdate,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

export interface ExamScoreboard {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
}

type ExamParticipationWithExam = NonNullable<
  Awaited<ReturnType<typeof participationRepo.findExamForScoring>>
>;

export async function updateExamScores(examId: string, userId: string): Promise<void> {
  await runScoreUpdate<ExamParticipationWithExam>(`${examId}:${userId}`, {
    load: () => participationRepo.findExamForScoring(examId, userId),
    submissions: (p) =>
      submissionRepo.findMany({
        where: { examId: p.exam.id, userId: p.userId, sampleOnly: false },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, problemId: true, score: true, status: true },
      }),
    overrides: (p) => scoreOverrideRepo.findAllByContext("exam", p.exam.id),
    problemIds: (p) => new Set(p.exam.problems.map((ep) => ep.problemId)),
    problemPoints: (p) => new Map(p.exam.problems.map((ep) => [ep.problemId, ep.points])),
    scoringMode: (p) => p.exam.scoringMode,
    startsAt: (p) => p.exam.startsAt,
    userId: (p) => p.userId,
    persist: (p, fields) => participationRepo.updateWithVersion(p.id, p.version, fields),
    isConflict: (err) => err instanceof UnifiedParticipationVersionConflict,
  });
}

export async function getExamScoreboard(
  examId: string,
  options?: { isPrivileged?: boolean },
): Promise<ExamScoreboard> {
  const exam = await examRepo.findForScoreboard(examId);

  if (exam?.status !== "published") {
    throw new NotFoundError("Exam not found.");
  }

  const scoreboardMode = exam.scoreboardMode;

  const problems: ScoreboardProblem[] = exam.problems.map((ep) => ({
    id: ep.problemId,
    ordinal: ep.ordinal,
    points: ep.points,
    title: ep.problem.title,
  }));

  const scoringMode = exam.scoringMode;

  if (scoreboardMode === "hidden" && !options?.isPrivileged) {
    return {
      entries: [],
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const participants: ParticipantRow[] =
    await participationRepo.findExamScoreboardParticipants(examId);

  if (participants.length === 0) {
    return {
      entries: [],
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const rawSubmissions = await submissionRepo.findMany({
    where: {
      examId: exam.id,
      sampleOnly: false,
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      problemId: true,
      score: true,
      status: true,
      userId: true,
    },
  });

  const submissions: SubmissionRow[] = rawSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.userId,
  }));

  const session: TimedSession = {
    id: exam.id,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    frozenAt: null,
  };

  const entries = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    false,
  );

  return {
    entries,
    problems,
    scoreboardMode,
    scoringMode,
  };
}
