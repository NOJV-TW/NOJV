import type Redis from "ioredis";

import { getRedis } from "./connection";
import { keys } from "./keys";
import { scoreboardUpdateLatency, type ScoreboardUpdateMode } from "./metrics";

const SCOREBOARD_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const MIN_SCOREBOARD_TTL_SECONDS = 60 * 60; // 1 hour

export function scoreboardTtlForEndsAt(
  endsAt: Date,
  graceSeconds = 7 * 24 * 60 * 60,
  now: Date = new Date(),
): number {
  const secondsUntilGraceEnd =
    Math.floor((endsAt.getTime() - now.getTime()) / 1000) + graceSeconds;
  return Math.max(MIN_SCOREBOARD_TTL_SECONDS, secondsUntilGraceEnd);
}

async function execPipeline(pipeline: ReturnType<Redis["pipeline"]>): Promise<void> {
  const results = await pipeline.exec();
  for (const [err] of results ?? []) {
    if (err) throw err;
  }
}

function parseZsetWithScores(raw: string[]): { participationId: string; score: number }[] {
  const entries: { participationId: string; score: number }[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const participationId = raw[i];
    const scoreStr = raw[i + 1];
    if (participationId != null && scoreStr != null) {
      entries.push({ participationId, score: Number(scoreStr) });
    }
  }
  return entries;
}

export async function updateScoreboard(
  contestId: string,
  participationId: string,
  score: number,
  mode: ScoreboardUpdateMode,
  ttlSeconds: number = SCOREBOARD_TTL_SECONDS,
): Promise<void> {
  const key = keys.scoreboard(contestId);
  const startMs = performance.now();
  try {
    await execPipeline(
      getRedis()
        .pipeline()
        .zadd(key, score.toString(), participationId)
        .expire(key, ttlSeconds),
    );
  } finally {
    scoreboardUpdateLatency.record((performance.now() - startMs) / 1000, { mode });
  }
}

export async function getScoreboard(
  contestId: string,
  start = 0,
  stop = -1,
): Promise<{ participationId: string; score: number }[]> {
  const redis = getRedis();
  const frozenKey = keys.scoreboardFrozen(contestId);
  const liveKey = keys.scoreboard(contestId);
  const hasFrozen = await redis.exists(frozenKey);
  const key = hasFrozen ? frozenKey : liveKey;

  return parseZsetWithScores(await redis.zrevrange(key, start, stop, "WITHSCORES"));
}

export async function freezeScoreboard(
  contestId: string,
  ttlSeconds: number = SCOREBOARD_TTL_SECONDS,
): Promise<void> {
  const redis = getRedis();
  const key = keys.scoreboard(contestId);
  const frozenKey = keys.scoreboardFrozen(contestId);

  await redis.zrangestore(frozenKey, key, 0, -1);
  await redis.expire(frozenKey, ttlSeconds);
}

export async function unfreezeScoreboard(contestId: string): Promise<void> {
  await getRedis().del(keys.scoreboardFrozen(contestId));
}
