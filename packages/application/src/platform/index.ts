import { problemRepo, submissionRepo, userRepo } from "@nojv/db";
import { getRedis, keys } from "@nojv/redis";
import { z } from "zod";

const PLATFORM_OVERVIEW_CACHE_TTL_SECONDS = 300;
const PLATFORM_OVERVIEW_LOCK_TTL_SECONDS = 5;
const PLATFORM_OVERVIEW_LOCK_POLL_ATTEMPTS = 5;
const PLATFORM_OVERVIEW_LOCK_POLL_INTERVAL_MS = 80;
const TREND_DAYS = 30;
const HOT_PROBLEMS_LIMIT = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const platformOverviewSchema = z.object({
  totals: z.object({
    users: z.number(),
    publicProblems: z.number(),
    submissions30d: z.number(),
    acRate30d: z.number(),
  }),
  daily: z.array(
    z.object({
      day: z.string(),
      label: z.string(),
      total: z.number(),
      accepted: z.number(),
      activeUsers: z.number(),
    }),
  ),
  byVerdict: z.array(z.object({ status: z.string(), count: z.number() })),
  byLanguage: z.array(z.object({ language: z.string(), count: z.number() })),
  hotProblems: z.array(
    z.object({
      id: z.string(),
      displayId: z.number().nullable(),
      title: z.string(),
      attempts: z.number(),
      accepted: z.number(),
    }),
  ),
});

export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function subDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function reviveCachedPlatformOverview(raw: string | null): PlatformOverview | null {
  if (!raw) return null;
  try {
    const parsed = platformOverviewSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const cacheKey = keys.platformOverview();
  const lockKey = keys.platformOverviewLock();
  const redis = getRedis();

  const cached = reviveCachedPlatformOverview(await redis.get(cacheKey).catch(() => null));
  if (cached) return cached;

  let acquired: boolean;
  try {
    acquired =
      (await redis.set(lockKey, "1", "EX", PLATFORM_OVERVIEW_LOCK_TTL_SECONDS, "NX")) === "OK";
  } catch {
    return computePlatformOverview();
  }

  if (!acquired) {
    for (let attempt = 0; attempt < PLATFORM_OVERVIEW_LOCK_POLL_ATTEMPTS; attempt++) {
      await sleep(PLATFORM_OVERVIEW_LOCK_POLL_INTERVAL_MS);
      const polled = reviveCachedPlatformOverview(await redis.get(cacheKey).catch(() => null));
      if (polled) return polled;
    }
    return computePlatformOverview();
  }

  try {
    const result = await computePlatformOverview();
    await redis
      .set(cacheKey, JSON.stringify(result), "EX", PLATFORM_OVERVIEW_CACHE_TTL_SECONDS)
      .catch(() => undefined);
    return result;
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

async function computePlatformOverview(): Promise<PlatformOverview> {
  const today = startOfDay(new Date());
  const from = subDays(today, TREND_DAYS - 1);

  const [users, publicProblems, rows] = await Promise.all([
    userRepo.countAll(),
    problemRepo.countPublic(),
    submissionRepo.findForPlatformStats(from),
  ]);

  const dailyMap = new Map<string, { total: number; accepted: number; users: Set<string> }>();
  for (let i = 0; i < TREND_DAYS; i++) {
    const day = dayKey(subDays(today, TREND_DAYS - 1 - i));
    dailyMap.set(day, { total: 0, accepted: 0, users: new Set() });
  }

  const verdictCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const problemCounts = new Map<string, { attempts: number; accepted: number }>();

  for (const row of rows) {
    const isAc = row.status === "accepted";
    const bucket = dailyMap.get(dayKey(row.createdAt));
    if (bucket) {
      bucket.total += 1;
      if (isAc) bucket.accepted += 1;
      bucket.users.add(row.userId);
    }
    verdictCounts.set(row.status, (verdictCounts.get(row.status) ?? 0) + 1);
    languageCounts.set(row.language, (languageCounts.get(row.language) ?? 0) + 1);
    const problemBucket = problemCounts.get(row.problemId) ?? { attempts: 0, accepted: 0 };
    problemBucket.attempts += 1;
    if (isAc) problemBucket.accepted += 1;
    problemCounts.set(row.problemId, problemBucket);
  }

  const submissions30d = rows.length;
  const accepted30d = verdictCounts.get("accepted") ?? 0;
  const acRate30d = submissions30d > 0 ? Math.round((accepted30d / submissions30d) * 100) : 0;

  const problemIds = [...problemCounts.keys()];
  const publicRows =
    problemIds.length > 0 ? await problemRepo.findPublicMiniByIds(problemIds) : [];
  const hotProblems = publicRows
    .map((problem) => {
      const counts = problemCounts.get(problem.id) ?? { attempts: 0, accepted: 0 };
      return {
        id: problem.id,
        displayId: problem.displayId,
        title: problem.title,
        attempts: counts.attempts,
        accepted: counts.accepted,
      };
    })
    .sort((a, b) => b.attempts - a.attempts || a.title.localeCompare(b.title))
    .slice(0, HOT_PROBLEMS_LIMIT);

  return {
    totals: { users, publicProblems, submissions30d, acRate30d },
    daily: [...dailyMap.entries()].map(([day, value]) => ({
      day,
      label: day.slice(5),
      total: value.total,
      accepted: value.accepted,
      activeUsers: value.users.size,
    })),
    byVerdict: [...verdictCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    byLanguage: [...languageCounts.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language)),
    hotProblems,
  };
}
