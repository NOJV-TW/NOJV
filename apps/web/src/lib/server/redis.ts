import Redis from "ioredis";
import { parseRedisConnection } from "@nojv/core";

// --- Connection Management ---

let _redis: Redis | undefined;

function getRedis(): Redis {
  if (!_redis) {
    const opts = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");
    _redis = new Redis({ host: opts.host, port: opts.port, password: opts.password });
  }
  return _redis;
}

export function createSubscriber(redisUrl: string): Redis {
  const opts = parseRedisConnection(redisUrl);
  return new Redis({ host: opts.host, port: opts.port, password: opts.password });
}

// --- Submit Cooldown ---

export async function setCooldown(userId: string, problemId: string, seconds: number): Promise<boolean> {
  const key = `nojv:cooldown:${userId}:${problemId}`;
  const result = await getRedis().set(key, "1", "EX", seconds, "NX");
  return result === "OK";
}

export async function checkCooldown(userId: string, problemId: string): Promise<boolean> {
  const key = `nojv:cooldown:${userId}:${problemId}`;
  return (await getRedis().exists(key)) === 1;
}

// --- Scoreboard (Sorted Set) ---

export async function updateScoreboard(
  contestId: string,
  participationId: string,
  score: number
): Promise<void> {
  const key = `nojv:scoreboard:${contestId}`;
  await getRedis().zadd(key, score.toString(), participationId);
}

export async function getScoreboard(
  contestId: string,
  start = 0,
  stop = -1
): Promise<{ participationId: string; score: number }[]> {
  const key = `nojv:scoreboard:${contestId}`;
  const results = await getRedis().zrevrange(key, start, stop, "WITHSCORES");
  const entries: { participationId: string; score: number }[] = [];
  for (let i = 0; i < results.length; i += 2) {
    entries.push({
      participationId: results[i]!,
      score: Number(results[i + 1]!)
    });
  }
  return entries;
}

export async function freezeScoreboard(contestId: string): Promise<void> {
  const key = `nojv:scoreboard:${contestId}`;
  const frozenKey = `${key}:frozen`;
  await getRedis().rename(key, frozenKey);
}

// --- Hot Data Cache (Cache-Aside) ---

export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await getRedis().get(`nojv:cache:${key}`);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await getRedis().set(`nojv:cache:${key}`, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(`nojv:cache:${key}`);
}
