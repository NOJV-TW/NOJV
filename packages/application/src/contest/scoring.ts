import {
  contestRepo,
  participationRepo,
  UnifiedParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import type { ContestScoringMode, ScoreboardMode } from "@nojv/core";

import { NotFoundError } from "../shared/errors";
import {
  buildScoreboard,
  buildScoreboardChartSeries,
  runScoreUpdate,
  type ParticipantRow,
  type ScoreboardEntry,
  type ScoreboardProblem,
  type SubmissionRow,
  type TimedSession,
} from "../scoring";

export type { ProblemScore, ScoreboardEntry, ScoreboardProblem } from "../scoring";

export interface Scoreboard {
  entries: ScoreboardEntry[];
  problems: ScoreboardProblem[];
  scoringMode: ContestScoringMode;
  scoreboardMode: ScoreboardMode;
  frozenAt: string | null;
  isFrozen: boolean;
}

export interface ScoreboardChart {
  series: {
    userId: string;
    username: string;
    points: { time: number; score: number }[];
  }[];
}

type ContestParticipationWithContest = NonNullable<
  Awaited<ReturnType<typeof participationRepo.findContestForScoring>>
>;

export async function updateContestScores(
  contestId: string,
  userId: string,
): Promise<string | null> {
  const participation = await runScoreUpdate<ContestParticipationWithContest>(
    `${contestId}:${userId}`,
    {
      load: () => participationRepo.findContestForScoring(contestId, userId),
      submissions: (p) => submissionRepo.findForContestScoring(p.contest.id, p.userId),
      overrides: (p) => scoreOverrideRepo.findAllByContext("contest", p.contest.id),
      problemIds: (p) => new Set(p.contest.problems.map((cp) => cp.problemId)),
      scoringMode: (p) => p.contest.scoringMode,
      startsAt: (p) => p.contest.startsAt,
      penaltyPerWrongSec: (p) => p.contest.penaltyMinutesPerWrong * 60,
      userId: (p) => p.userId,
      persist: (p, fields) => participationRepo.updateWithVersion(p.id, p.version, fields),
      isConflict: (err) => err instanceof UnifiedParticipationVersionConflict,
    },
  );

  return participation ? participation.contest.id : null;
}

export async function getScoreboard(
  contestId: string,
  options?: { canSeeLive?: boolean },
): Promise<Scoreboard> {
  const canSeeLive = options?.canSeeLive === true;
  const contest = await contestRepo.findForScoreboardById(contestId);

  if (!contest || contest.visibility === "draft") {
    throw new NotFoundError("Contest not found.");
  }

  const now = new Date();
  const scoreboardMode = contest.scoreboardMode;
  const showFrozen =
    !canSeeLive &&
    (scoreboardMode === "frozen" ||
      (contest.frozenBoard && contest.frozenAt != null && now > contest.frozenAt));

  const problems: ScoreboardProblem[] = contest.problems.map((cp) => ({
    id: cp.problemId,
    ordinal: cp.ordinal,
    points: cp.points,
    title: cp.problem.title,
  }));

  const scoringMode = contest.scoringMode;

  if (scoreboardMode === "hidden" && !canSeeLive) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: false,
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const participants: ParticipantRow[] =
    await participationRepo.findContestScoreboardParticipants(contestId);

  if (participants.length === 0) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: showFrozen,
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const allSubmissions = await submissionRepo.findForContestScoreboardByContestId(contestId);

  const submissions: SubmissionRow[] = allSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.userId,
  }));

  const session: TimedSession = {
    id: contest.id,
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    frozenAt: contest.frozenAt,
    penaltyPerWrongSec: contest.penaltyMinutesPerWrong * 60,
  };

  const entries = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    showFrozen,
  );

  return {
    entries,
    frozenAt: contest.frozenAt?.toISOString() ?? null,
    isFrozen: showFrozen,
    problems,
    scoreboardMode,
    scoringMode,
  };
}

export async function getScoreboardChart(
  contestId: string,
  topN: number,
  options?: { canSeeLive?: boolean; precomputed?: Scoreboard },
): Promise<ScoreboardChart> {
  const scoreboardData =
    options?.precomputed ??
    (await getScoreboard(contestId, { canSeeLive: options?.canSeeLive === true }));

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  const contest = await contestRepo.findInfoById(contestId);

  const submissions = await submissionRepo.findForContestChartByContestId(contestId, [
    ...topUserIds,
  ]);

  const frozenCutoff =
    scoreboardData.isFrozen && scoreboardData.frozenAt
      ? new Date(scoreboardData.frozenAt)
      : null;

  const submissionsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    if (frozenCutoff && sub.createdAt > frozenCutoff) continue;
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
    contest.startsAt,
    scoreboardData.scoringMode,
    [...topUserIds],
    submissionsByUser,
    usernameMap,
    pointsMap,
  );

  return { series };
}
