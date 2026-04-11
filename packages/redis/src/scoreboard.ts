import type Redis from "ioredis";

import { getRedis } from "./connection";
import { keys } from "./keys";

// Scoreboard keys are refreshed on every write so active contests stay alive,
// but ended contests release the memory after the grace window.
const SCOREBOARD_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// Batch a pipeline into one round-trip while still surfacing per-command
// errors so callers see them instead of silently continuing.
async function execPipeline(pipeline: ReturnType<Redis["pipeline"]>): Promise<void> {
  const results = await pipeline.exec();
  for (const [err] of results ?? []) {
    if (err) throw err;
  }
}

export async function updateScoreboard(
  contestId: string,
  participationId: string,
  score: number
): Promise<void> {
  const key = keys.scoreboard(contestId);
  await execPipeline(
    getRedis()
      .pipeline()
      .zadd(key, score.toString(), participationId)
      .expire(key, SCOREBOARD_TTL_SECONDS)
  );
}

/**
 * Return the scoreboard for a contest.
 *
 * If a frozen snapshot exists (because `freezeScoreboard` was called and
 * `unfreezeScoreboard` has not yet been called), the snapshot is returned
 * — this is the public view during the freeze period. Otherwise the live
 * board is returned.
 */
export async function getScoreboard(
  contestId: string,
  start = 0,
  stop = -1
): Promise<{ participationId: string; score: number }[]> {
  const redis = getRedis();
  const frozenKey = keys.scoreboardFrozen(contestId);
  const liveKey = keys.scoreboard(contestId);
  const hasFrozen = await redis.exists(frozenKey);
  const key = hasFrozen ? frozenKey : liveKey;

  const results = await redis.zrevrange(key, start, stop, "WITHSCORES");
  const entries: { participationId: string; score: number }[] = [];
  for (let i = 0; i + 1 < results.length; i += 2) {
    const participationId = results[i];
    const scoreStr = results[i + 1];
    if (participationId != null && scoreStr != null) {
      entries.push({ participationId, score: Number(scoreStr) });
    }
  }
  return entries;
}

/**
 * Snapshot the current live scoreboard into the frozen key.
 *
 * The live key keeps updating after freeze (so admins can see real-time
 * scores), but `getScoreboard` returns the frozen snapshot while it exists.
 * Idempotent: calling twice replaces the previous snapshot with the
 * current live state.
 */
export async function freezeScoreboard(contestId: string): Promise<void> {
  const redis = getRedis();
  const key = keys.scoreboard(contestId);
  const frozenKey = keys.scoreboardFrozen(contestId);

  // Copy live → frozen via ZRANGE + ZADD to avoid depending on Redis 6.2+
  // ZRANGESTORE. Clears any existing snapshot first.
  await redis.del(frozenKey);
  const entries = await redis.zrange(key, 0, -1, "WITHSCORES");
  if (entries.length === 0) return;

  const zaddArgs: string[] = [];
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const member = entries[i];
    const score = entries[i + 1];
    if (member != null && score != null) {
      zaddArgs.push(score, member);
    }
  }
  if (zaddArgs.length > 0) {
    await execPipeline(
      redis
        .pipeline()
        .zadd(frozenKey, ...zaddArgs)
        .expire(frozenKey, SCOREBOARD_TTL_SECONDS)
    );
  }
}

/**
 * Remove the frozen snapshot so `getScoreboard` returns the live board again.
 * Any submissions judged during the frozen period are preserved in the live key
 * and become visible immediately.
 */
export async function unfreezeScoreboard(contestId: string): Promise<void> {
  await getRedis().del(keys.scoreboardFrozen(contestId));
}
