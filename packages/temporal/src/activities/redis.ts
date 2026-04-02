import Redis from "ioredis";

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsed = new URL(url);
  _redis = new Redis({
    host: parsed.hostname,
    port: Number(parsed.port || "6379"),
    password: parsed.password || undefined
  });
  return _redis;
}

export async function updateScoreboard(
  contestId: string,
  participationId: string,
  score: number,
  scoringMode: string
): Promise<void> {
  const redis = getRedis();
  const key = `nojv:scoreboard:${contestId}`;
  await redis.zadd(key, String(score), participationId);
}

export async function getScoreboard(
  contestId: string,
  start: number,
  stop: number
): Promise<string[]> {
  const redis = getRedis();
  const key = `nojv:scoreboard:${contestId}`;
  return redis.zrevrange(key, start, stop);
}

export async function setCooldown(
  userId: string,
  problemId: string,
  seconds: number
): Promise<boolean> {
  const redis = getRedis();
  const key = `nojv:cooldown:${userId}:${problemId}`;
  const result = await redis.set(key, "1", "EX", seconds, "NX");
  return result === "OK";
}

export async function checkCooldown(userId: string, problemId: string): Promise<boolean> {
  const redis = getRedis();
  const key = `nojv:cooldown:${userId}:${problemId}`;
  return (await redis.exists(key)) === 1;
}

export async function cacheGet(key: string): Promise<string | null> {
  return getRedis().get(key);
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, value, "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await getRedis().del(key);
}
