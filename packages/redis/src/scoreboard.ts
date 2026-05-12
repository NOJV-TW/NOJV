import type Redis from "ioredis";

import { getRedis } from "./connection";
import { keys } from "./keys";
import { scoreboardUpdateLatency, type ScoreboardUpdateMode } from "./metrics";

// TTL refreshed on every write so active contests stay alive; ended ones expire.
const SCOREBOARD_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

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
): Promise<void> {
  const key = keys.scoreboard(contestId);
  const startMs = performance.now();
  try {
    await execPipeline(
      getRedis()
        .pipeline()
        .zadd(key, score.toString(), participationId)
        .expire(key, SCOREBOARD_TTL_SECONDS),
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
export async function freezeScoreboard(contestId: string): Promise<void> {
  const redis = getRedis();
  const key = keys.scoreboard(contestId);
  const frozenKey = keys.scoreboardFrozen(contestId);

  // ZRANGE + ZADD instead of ZRANGESTORE to avoid depending on Redis 6.2+.
  await redis.del(frozenKey);
  const entries = parseZsetWithScores(await redis.zrange(key, 0, -1, "WITHSCORES"));
  if (entries.length === 0) return;

  // ZADD takes score-then-member; flatten back from parsed entries.
  const zaddArgs = entries.flatMap((e) => [e.score.toString(), e.participationId]);
  await execPipeline(
    redis
      .pipeline()
      .zadd(frozenKey, ...zaddArgs)
      .expire(frozenKey, SCOREBOARD_TTL_SECONDS),
  );
}

export async function unfreezeScoreboard(contestId: string): Promise<void> {
  await getRedis().del(keys.scoreboardFrozen(contestId));
}
