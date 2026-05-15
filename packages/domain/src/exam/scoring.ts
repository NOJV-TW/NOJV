import {
  examRepo,
  examParticipationRepo,
  ExamParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";
import { scoreboard } from "@nojv/redis";

import { ConflictError, NotFoundError } from "../shared/errors";
import {
  buildScoreboard,
  buildScoreboardChartSeries,
  computeProblemCountPenalty,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

// Cuid IDs cannot collide, so Exam and Contest share the Redis scoreboard namespace.
export interface ExamScoreboard {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
}

const SCORE_UPDATE_MAX_ATTEMPTS = 3;

/**
 * Recompute and persist an exam participant's score / penalty / per-problem
 * subtotals from their submissions and any active overrides.
 *
 * Concurrency: parallel score recomputes for the same participation (rejudge
 * fan-out, override edits, late submissions) would lost-update each other.
 * The repo enforces optimistic locking on the participation row's `version`
 * column; on conflict we re-read submissions+overrides and recompute, up to
 * SCORE_UPDATE_MAX_ATTEMPTS. If we still lose the race, we throw
 * `ConflictError` and let the caller's retry policy take over. Mirrors
 * `updateContestScores`.
 */
export async function updateExamScores(examParticipationId: string): Promise<void> {
  for (let attempt = 1; attempt <= SCORE_UPDATE_MAX_ATTEMPTS; attempt++) {
    const participation = await examParticipationRepo.findByIdWithExam(examParticipationId);

    if (!participation) return;

    const { exam } = participation;

    // Exam submissions are keyed off `Submission.examId`, not a
    // participation FK. Fetch them directly for this participant.
    const allSubmissions = await submissionRepo.findMany({
      where: {
        examId: exam.id,
        userId: participation.userId,
        sampleOnly: false,
      },
      orderBy: { createdAt: "asc" },
      select: {
        createdAt: true,
        problemId: true,
        score: true,
        status: true,
      },
    });

    const examProblems = new Map(exam.problems.map((p) => [p.problemId, p]));

    try {
      if (exam.scoringMode === "problem_count") {
        let solvedCount = 0;
        let totalPenalty = 0;

        const byProblem = new Map<string, typeof allSubmissions>();
        for (const sub of allSubmissions) {
          if (!examProblems.has(sub.problemId)) continue;
          const existing = byProblem.get(sub.problemId) ?? [];
          existing.push(sub);
          byProblem.set(sub.problemId, existing);
        }

        for (const [, problemSubs] of byProblem) {
          const { solved, penaltySeconds } = computeProblemCountPenalty(
            problemSubs,
            exam.startsAt,
          );
          if (solved) {
            solvedCount++;
            totalPenalty += penaltySeconds;
          }
        }

        await examParticipationRepo.updateWithVersion(participation.id, participation.version, {
          penaltySeconds: totalPenalty,
          score: solvedCount,
        });

        const packedScore = solvedCount * 1e9 - totalPenalty;
        await scoreboard.updateScoreboard(
          exam.id,
          participation.id,
          packedScore,
          "icpc",
          scoreboard.scoreboardTtlForEndsAt(exam.endsAt),
        );
      } else {
        const bestByProblem = new Map<string, number>();
        for (const sub of allSubmissions) {
          if (!examProblems.has(sub.problemId)) continue;
          const current = bestByProblem.get(sub.problemId) ?? 0;
          if (sub.score > current) bestByProblem.set(sub.problemId, sub.score);
        }

        // Overlay any per-problem overrides for this participant.
        const overrideRows = await scoreOverrideRepo.findAllByContext("exam", exam.id);
        for (const row of overrideRows) {
          if (row.userId !== participation.userId) continue;
          if (!examProblems.has(row.problemId)) continue;
          bestByProblem.set(row.problemId, row.overrideScore);
        }

        let totalScore = 0;
        const subtaskScores: Record<string, number> = {};
        for (const [problemId, best] of bestByProblem) {
          totalScore += best;
          subtaskScores[problemId] = best;
        }

        await examParticipationRepo.updateWithVersion(participation.id, participation.version, {
          score: totalScore,
          subtaskScores,
        });

        await scoreboard.updateScoreboard(
          exam.id,
          participation.id,
          totalScore,
          "ioi",
          scoreboard.scoreboardTtlForEndsAt(exam.endsAt),
        );
      }

      return;
    } catch (err) {
      if (err instanceof ExamParticipationVersionConflict) {
        // Another writer landed first — retry on a fresh read.
        continue;
      }
      throw err;
    }
  }

  throw new ConflictError(
    `Could not persist score for exam participation ${examParticipationId} after ${String(SCORE_UPDATE_MAX_ATTEMPTS)} attempts.`,
  );
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

  // Exam submissions are keyed by examId directly; fetch all non-sample rows.
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

export interface ExamScoreboardChart {
  series: {
    userId: string;
    username: string;
    points: { time: number; score: number }[];
  }[];
}

export async function getExamScoreboardChart(
  examId: string,
  topN: number,
): Promise<ExamScoreboardChart> {
  const scoreboardData = await getExamScoreboard(examId);

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  const exam = await examRepo.findInfoById(examId);

  const rawSubmissions = await submissionRepo.findMany({
    where: {
      examId,
      sampleOnly: false,
      userId: { in: [...topUserIds] },
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

  const submissionsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of rawSubmissions) {
    const row: SubmissionRow = {
      createdAt: sub.createdAt,
      problemId: sub.problemId,
      score: sub.score,
      status: sub.status,
      userId: sub.userId,
    };
    const existing = submissionsByUser.get(sub.userId);
    if (existing) existing.push(row);
    else submissionsByUser.set(sub.userId, [row]);
  }

  const usernameMap = new Map(topEntries.map((e) => [e.userId, e.username]));

  const series = buildScoreboardChartSeries(
    exam.startsAt,
    scoreboardData.scoringMode,
    [...topUserIds],
    submissionsByUser,
    usernameMap,
    pointsMap,
  );

  return { series };
}
