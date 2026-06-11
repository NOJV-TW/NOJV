import {
  examRepo,
  examParticipationRepo,
  ExamParticipationVersionConflict,
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
  Awaited<ReturnType<typeof examParticipationRepo.findByIdWithExam>>
>;

export async function updateExamScores(examParticipationId: string): Promise<void> {
  await runScoreUpdate<ExamParticipationWithExam>(examParticipationId, {
    load: () => examParticipationRepo.findByIdWithExam(examParticipationId),
    submissions: (p) =>
      submissionRepo.findMany({
        where: { examId: p.exam.id, userId: p.userId, sampleOnly: false },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, problemId: true, score: true, status: true },
      }),
    overrides: (p) => scoreOverrideRepo.findAllByContext("exam", p.exam.id),
    problemIds: (p) => new Set(p.exam.problems.map((ep) => ep.problemId)),
    scoringMode: (p) => p.exam.scoringMode,
    startsAt: (p) => p.exam.startsAt,
    userId: (p) => p.userId,
    persist: (p, fields) => examParticipationRepo.updateWithVersion(p.id, p.version, fields),
    isConflict: (err) => err instanceof ExamParticipationVersionConflict,
  });
}

/**
 * Recompute persisted exam scores for a (exam, user) pair after their submission
 * is judged. Mirrors the contest path (`updateContestScores`): the judge workflow
 * knows the examId + userId but not the participation id, so resolve it here.
 * No-ops if the user has no participation row yet.
 */
export async function updateExamScoresForUser(examId: string, userId: string): Promise<void> {
  const participationId = await examParticipationRepo.findIdByExamAndUser(examId, userId);
  if (participationId) {
    await updateExamScores(participationId);
  }
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

  if (exam.participations.length === 0) {
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

  const participants: ParticipantRow[] = exam.participations;

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
