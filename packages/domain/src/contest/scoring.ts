import {
  contestRepo,
  contestParticipationRepo,
  ParticipationVersionConflict,
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
  Awaited<ReturnType<typeof contestParticipationRepo.findByIdWithContest>>
>;

export async function updateContestScores(
  contestParticipationId: string,
): Promise<string | null> {
  const participation = await runScoreUpdate<ContestParticipationWithContest>(
    contestParticipationId,
    {
      load: () => contestParticipationRepo.findByIdWithContest(contestParticipationId),
      submissions: (p) => submissionRepo.findForParticipationScoring(p.id),
      overrides: (p) => scoreOverrideRepo.findAllByContext("contest", p.contest.id),
      problemIds: (p) => new Set(p.contest.problems.map((cp) => cp.problemId)),
      scoringMode: (p) => p.contest.scoringMode,
      startsAt: (p) => p.contest.startsAt,
      userId: (p) => p.userId,
      persist: (p, fields) =>
        contestParticipationRepo.updateWithVersion(p.id, p.version, fields),
      isConflict: (err) => err instanceof ParticipationVersionConflict,
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

  if (contest.participations.length === 0) {
    return {
      entries: [],
      frozenAt: contest.frozenAt?.toISOString() ?? null,
      isFrozen: showFrozen,
      problems,
      scoreboardMode,
      scoringMode,
    };
  }

  const participationIds = contest.participations.map((p) => p.id);
  const allSubmissions = await submissionRepo.findForContestScoreboard(participationIds);

  const submissions: SubmissionRow[] = allSubmissions.map((s) => ({
    createdAt: s.createdAt,
    problemId: s.problemId,
    score: s.score,
    status: s.status,
    userId: s.contestParticipation?.userId ?? "",
  }));

  const participants: ParticipantRow[] = contest.participations;

  const session: TimedSession = {
    id: contest.id,
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    frozenAt: contest.frozenAt,
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
  options?: { canSeeLive?: boolean },
): Promise<ScoreboardChart> {
  const scoreboardData = await getScoreboard(contestId, {
    canSeeLive: options?.canSeeLive === true,
  });

  const topEntries = scoreboardData.entries.slice(0, topN);
  if (topEntries.length === 0) {
    return { series: [] };
  }

  const topUserIds = new Set(topEntries.map((e) => e.userId));

  const pointsMap = new Map(scoreboardData.problems.map((p) => [p.id, p.points]));

  const contest = await contestRepo.findForChartById(contestId, [...topUserIds]);

  if (!contest) return { series: [] };

  const participationUserMap = new Map(contest.participations.map((p) => [p.id, p.userId]));

  const participationIds = contest.participations.map((p) => p.id);
  const submissions = await submissionRepo.findForContestChart(participationIds);

  const frozenCutoff =
    scoreboardData.isFrozen && scoreboardData.frozenAt
      ? new Date(scoreboardData.frozenAt)
      : null;

  const submissionsByUser = new Map<string, SubmissionRow[]>();
  for (const sub of submissions) {
    if (frozenCutoff && sub.createdAt > frozenCutoff) continue;
    const userId = participationUserMap.get(sub.contestParticipationId ?? "");
    if (!userId) continue;
    const row: SubmissionRow = {
      createdAt: sub.createdAt,
      problemId: sub.problemId,
      score: sub.score,
      status: sub.status,
      userId,
    };
    const existing = submissionsByUser.get(userId);
    if (existing) existing.push(row);
    else submissionsByUser.set(userId, [row]);
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
