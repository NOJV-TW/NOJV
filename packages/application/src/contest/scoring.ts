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
import { createRateLimiterConnection, keys } from "@nojv/redis";
import { z } from "zod";

import { NotFoundError } from "../shared/errors";

const SCOREBOARD_CACHE_TTL_SECONDS = 10;
const SCOREBOARD_LOCK_TTL_SECONDS = 5;
const SCOREBOARD_LOCK_POLL_ATTEMPTS = 5;
const SCOREBOARD_LOCK_POLL_INTERVAL_MS = 80;

let scoreboardRedisClient: ReturnType<typeof createRateLimiterConnection> | undefined;

function scoreboardRedis(): ReturnType<typeof createRateLimiterConnection> {
  scoreboardRedisClient ??= createRateLimiterConnection();
  return scoreboardRedisClient;
}

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

const scoreboardChartSchema = z.object({
  series: z.array(
    z.object({
      userId: z.string(),
      username: z.string(),
      points: z.array(z.object({ time: z.number(), score: z.number() })),
    }),
  ),
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

async function readCachedScoreboard(
  redis: ReturnType<typeof scoreboardRedis>,
  cacheKey: string,
): Promise<Scoreboard | null> {
  try {
    const cached = await redis.get(cacheKey);
    if (cached === null) return null;
    const parsed = scoreboardSchema.safeParse(JSON.parse(cached));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function readCachedChart(
  redis: ReturnType<typeof scoreboardRedis>,
  cacheKey: string,
): Promise<ScoreboardChart | null> {
  try {
    const cached = await redis.get(cacheKey);
    if (cached === null) return null;
    const parsed = scoreboardChartSchema.safeParse(JSON.parse(cached));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getScoreboard(
  contestId: string,
  options?: { canSeeLive?: boolean },
): Promise<Scoreboard> {
  const canSeeLive = options?.canSeeLive === true;
  const variant = canSeeLive ? "live" : "public";
  const cacheKey = keys.scoreboardCache(contestId, variant);
  const lockKey = keys.scoreboardLock(contestId, variant);
  const redis = scoreboardRedis();

  const cached = await readCachedScoreboard(redis, cacheKey);
  if (cached) return cached;

  let acquired: boolean;
  try {
    acquired =
      (await redis.set(lockKey, "1", "EX", SCOREBOARD_LOCK_TTL_SECONDS, "NX")) === "OK";
  } catch {
    return computeScoreboard(contestId, canSeeLive);
  }

  if (!acquired) {
    for (let attempt = 0; attempt < SCOREBOARD_LOCK_POLL_ATTEMPTS; attempt++) {
      await sleep(SCOREBOARD_LOCK_POLL_INTERVAL_MS);
      const polled = await readCachedScoreboard(redis, cacheKey);
      if (polled) return polled;
    }
    return computeScoreboard(contestId, canSeeLive);
  }

  try {
    const result = await computeScoreboard(contestId, canSeeLive);
    await redis
      .set(cacheKey, JSON.stringify(result), "EX", SCOREBOARD_CACHE_TTL_SECONDS)
      .catch(() => undefined);
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
  const effectiveFrozenAt =
    scoreboardMode === "frozen" && contest.frozenAt == null ? now : contest.frozenAt;
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
      frozenAt: effectiveFrozenAt?.toISOString() ?? null,
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
      frozenAt: effectiveFrozenAt?.toISOString() ?? null,
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
    frozenAt: effectiveFrozenAt,
    penaltyPerWrongSec: contest.penaltyMinutesPerWrong * 60,
  };

  const overrides =
    scoringMode === "point_sum"
      ? await scoreOverrideRepo.findAllByContext("contest", contestId)
      : [];

  const entries = buildScoreboard(
    session,
    scoringMode,
    participants,
    submissions,
    problems,
    showFrozen,
    overrides,
  );

  return {
    entries,
    frozenAt: effectiveFrozenAt?.toISOString() ?? null,
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
  const variant = options?.canSeeLive === true ? "live" : "public";
  const chartCacheKey = keys.scoreboardChartCache(contestId, variant, topN);
  const redis = scoreboardRedis();

  const cachedChart = await readCachedChart(redis, chartCacheKey);
  if (cachedChart) return cachedChart;

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

  const result: ScoreboardChart = { series };
  try {
    await redis.set(chartCacheKey, JSON.stringify(result), "EX", SCOREBOARD_CACHE_TTL_SECONDS);
  } catch {
    return result;
  }
  return result;
}
