import {
  contestRepo,
  courseRepo,
  assessmentRepo,
  problemRepo,
  submissionRepo,
  userRepo
} from "@nojv/db";

// ─── Helpers ───────────────────────────────────────────────────────

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

// ─── Admin dashboard monitoring ────────────────────────────────────

export async function getAdminDashboard() {
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
    recentErrors
  ] = await Promise.all([
    userRepo.countAll(),
    userRepo.count({ disabled: true }),
    userRepo.groupByRole(),
    courseRepo.count(),
    problemRepo.countAll(),
    contestRepo.count(),
    assessmentRepo.count(),
    submissionRepo.findInDateRange(from14d),
    submissionRepo.groupByStatus(from7d),
    submissionRepo.groupFailuresByProblem(from7d, 8),
    contestRepo
      .healthCheck()
      .then(() => true)
      .catch(() => false),
    submissionRepo.findRecentErrors(20)
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
  const failureProblems = problemIds.length > 0 ? await problemRepo.findByIds(problemIds) : [];
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
    dbOk
  };
}
