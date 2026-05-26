import type Redis from "ioredis";

import { getRedis } from "./connection";
import { keys } from "./keys";
import { scoreboardUpdateLatency, type ScoreboardUpdateMode } from "./metrics";

// Fallback TTL when the caller does not pass one (e.g. a write that has
// no `endsAt` context). Refreshed on every write so active boards stay
// alive; ended ones expire.
const SCOREBOARD_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Floor so an `endsAt`-derived TTL for an already-ended contest still
// leaves the board readable briefly after a late recompute lands.
const MIN_SCOREBOARD_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Derive a Redis TTL from a contest/exam end time: the board lives until
 * `endsAt` plus a grace window so post-mortem viewing works, then expires
 * instead of squatting memory for the full fallback period. Active boards
 * keep refreshing on every submission, so an in-progress contest never
 * actually hits the floor.
 */
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

// Walks an alternating [member, score, member, score, ...] WITHSCORES reply.
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
    // try/finally so failure latency is still recorded — useful for the dashboard.
    scoreboardUpdateLatency.record((performance.now() - startMs) / 1000, { mode });
  }
}

/** Returns the frozen snapshot if present, otherwise the live board. */
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

/** Snapshots live → frozen. Live key keeps updating; `getScoreboard` hides it until unfreeze. */
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
