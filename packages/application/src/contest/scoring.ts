import {
  contestRepo,
  participationRepo,
  UnifiedParticipationVersionConflict,
  scoreOverrideRepo,
  submissionRepo,
} from "@nojv/db";
import {
  contestScoringModeSchema,
  scoreboardModeSchema,
  type ContestScoringMode,
  type ScoreboardMode,
} from "@nojv/core";
import { getRedis, keys } from "@nojv/redis";
import { z } from "zod";

import { NotFoundError } from "../shared/errors";

const SCOREBOARD_CACHE_TTL_SECONDS = 10;
const SCOREBOARD_LOCK_TTL_SECONDS = 5;
const SCOREBOARD_LOCK_POLL_ATTEMPTS = 5;
const SCOREBOARD_LOCK_POLL_INTERVAL_MS = 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
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

const scoreboardSchema = z.object({
  entries: z.array(
    z.object({
      rank: z.number(),
      userId: z.string(),
      username: z.string(),
      displayName: z.string(),
      totalScore: z.number(),
      totalPenalty: z.number(),
      problems: z.array(
        z.object({
          problemId: z.string(),
          score: z.number(),
          attempts: z.number(),
          firstAcTime: z.number().nullable(),
          isFrozen: z.boolean(),
          isPending: z.boolean(),
        }),
      ),
      isFirstBlood: z.array(z.boolean()),
    }),
  ),
  problems: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      ordinal: z.number(),
      points: z.number(),
    }),
  ),
  scoringMode: contestScoringModeSchema,
  scoreboardMode: scoreboardModeSchema,
  frozenAt: z.string().nullable(),
  isFrozen: z.boolean(),
});

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
      submissions: async (p) => {
        const rows = await submissionRepo.findForContestScoring(p.contest.id, p.userId);
        const endsAt = p.contest.endsAt;
        return rows.filter((s) => s.createdAt <= endsAt);
      },
      overrides: (p) => scoreOverrideRepo.findAllByContext("contest", p.contest.id),
      problemIds: (p) => new Set(p.contest.problems.map((cp) => cp.problemId)),
      problemPoints: (p) => new Map(p.contest.problems.map((cp) => [cp.problemId, cp.points])),
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
  const variant = canSeeLive ? "live" : "public";
  const cacheKey = keys.scoreboardCache(contestId, variant);
  const redis = getRedis();

  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    const parsed = scoreboardSchema.safeParse(JSON.parse(cached));
    if (parsed.success) return parsed.data;
  }

  const lockKey = keys.scoreboardLock(contestId, variant);
  const acquired = await redis.set(lockKey, "1", "EX", SCOREBOARD_LOCK_TTL_SECONDS, "NX");

  if (acquired !== "OK") {
    for (let attempt = 0; attempt < SCOREBOARD_LOCK_POLL_ATTEMPTS; attempt++) {
      await sleep(SCOREBOARD_LOCK_POLL_INTERVAL_MS);
      const polled = await redis.get(cacheKey);
      if (polled !== null) {
        const parsed = scoreboardSchema.safeParse(JSON.parse(polled));
        if (parsed.success) return parsed.data;
      }
    }
    return computeScoreboard(contestId, canSeeLive);
  }

  try {
    const result = await computeScoreboard(contestId, canSeeLive);
    await redis.set(cacheKey, JSON.stringify(result), "EX", SCOREBOARD_CACHE_TTL_SECONDS);
    return result;
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

async function computeScoreboard(contestId: string, canSeeLive: boolean): Promise<Scoreboard> {
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

  const endsAt = contest.endsAt;
  const inWindow = allSubmissions.filter((s) => s.createdAt <= endsAt);

  const submissions: SubmissionRow[] = inWindow.map((s) => ({
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
