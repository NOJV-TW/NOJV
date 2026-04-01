import { Queue } from "bullmq";
import { parseRedisConnection, queueNames } from "@nojv/core";
import { prisma } from "@nojv/db";
import type { PageServerLoad } from "./$types";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayLabel(day: string): string {
  return day.slice(5);
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function subDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

async function readQueueSummary() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      queueCounts: null,
      queueError: "REDIS_URL is not set."
    };
  }

  try {
    const connection = parseRedisConnection(redisUrl);
    const queue = new Queue(queueNames.submission, { connection });
    const counts = await queue.getJobCounts();
    await queue.close();

    return {
      queueCounts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0
      },
      queueError: null
    };
  } catch (err) {
    return {
      queueCounts: null,
      queueError: err instanceof Error ? err.message : "Failed to connect to queue."
    };
  }
}

export const load: PageServerLoad = async () => {
  const now = new Date();
  const today = startOfDay(now);
  const from14d = subDays(today, 13);
  const from7d = subDays(today, 6);

  const [
    totalUsers,
    disabledUsers,
    roleGroups,
    totalCourses,
    totalProblems,
    totalContests,
    totalAssessments,
    submissions14d,
    statusGroups7d,
    failureGroups,
    dbOk,
    recentErrors,
    queueSummary
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { disabled: true } }),
    prisma.user.groupBy({ by: ["platformRole"], _count: { _all: true } }),
    prisma.course.count(),
    prisma.problem.count(),
    prisma.contest.count(),
    prisma.courseAssessment.count(),
    prisma.submission.findMany({
      where: { sampleOnly: false, createdAt: { gte: from14d } },
      select: { createdAt: true, status: true }
    }),
    prisma.submission.groupBy({
      by: ["status"],
      where: { sampleOnly: false, createdAt: { gte: from7d } },
      _count: { _all: true }
    }),
    prisma.submission.groupBy({
      by: ["problemId"],
      where: {
        sampleOnly: false,
        createdAt: { gte: from7d },
        status: {
          in: ["compile_error", "runtime_error", "time_limit_exceeded", "memory_limit_exceeded"]
        }
      },
      _count: { _all: true },
      orderBy: { _count: { problemId: "desc" } },
      take: 8
    }),
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.submission.findMany({
      where: {
        sampleOnly: false,
        status: {
          in: ["compile_error", "runtime_error", "time_limit_exceeded", "memory_limit_exceeded"]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        language: true,
        createdAt: true,
        user: { select: { username: true, name: true } },
        problem: { select: { slug: true, defaultTitle: true } }
      }
    }),
    readQueueSummary()
  ]);

  const roleCounts = {
    admin: 0,
    teacher: 0,
    student: 0
  };

  for (const row of roleGroups) {
    roleCounts[row.platformRole] = row._count._all;
  }

  const dailyMap = new Map<string, { total: number; accepted: number }>();
  for (let i = 0; i < 14; i++) {
    const day = dayKey(subDays(today, 13 - i));
    dailyMap.set(day, { total: 0, accepted: 0 });
  }

  for (const sub of submissions14d) {
    const day = dayKey(sub.createdAt);
    const bucket = dailyMap.get(day);
    if (!bucket) continue;
    bucket.total += 1;
    if (sub.status === "accepted") {
      bucket.accepted += 1;
    }
  }

  const dailySeries = [...dailyMap.entries()].map(([day, val]) => ({
    day,
    label: dayLabel(day),
    total: val.total,
    accepted: val.accepted
  }));

  const submissions7dTotal = statusGroups7d.reduce((sum, row) => sum + row._count._all, 0);
  const accepted7d = statusGroups7d.find((row) => row.status === "accepted")?._count._all ?? 0;
  const acceptedRate7d =
    submissions7dTotal > 0 ? Math.round((accepted7d / submissions7dTotal) * 100) : 0;

  const problemIds = failureGroups.map((row) => row.problemId);
  const failureProblems =
    problemIds.length > 0
      ? await prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: { id: true, slug: true, defaultTitle: true }
        })
      : [];
  const problemMap = new Map(
    failureProblems.map((problem) => [
      problem.id,
      { slug: problem.slug, title: problem.defaultTitle }
    ])
  );

  const topFailingProblems = failureGroups.map((row) => {
    const problem = problemMap.get(row.problemId);
    return {
      problemId: row.problemId,
      slug: problem?.slug ?? "unknown",
      title: problem?.title ?? "Unknown problem",
      errorCount: row._count._all
    };
  });

  return {
    kpi: {
      totalUsers,
      disabledUsers,
      totalCourses,
      totalProblems,
      totalContests,
      totalAssessments,
      submissions7dTotal,
      acceptedRate7d
    },
    roleCounts,
    statusBreakdown: statusGroups7d.map((row) => ({
      name: row.status,
      value: row._count._all
    })),
    dailySeries,
    topFailingProblems,
    recentErrors,
    queueCounts: queueSummary.queueCounts,
    queueError: queueSummary.queueError,
    dbOk
  };
};
