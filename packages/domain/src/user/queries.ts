import { problemRepo, submissionRepo, userRepo, type Prisma } from "@nojv/db";
import { aggregateByTag } from "./analytics-helpers";

export interface UserSearchParams {
  search?: string;
  roleFilter?: string;
  page?: number;
  take?: number;
}

export async function listUsersPaginated(params: UserSearchParams) {
  const take = params.take ?? 50;
  const page = Math.max(1, params.page ?? 1);
  const skip = (page - 1) * take;

  const where: Prisma.UserWhereInput = {};

  if (params.search) {
    where.OR = [
      { username: { contains: params.search, mode: "insensitive" } },
      { email: { contains: params.search, mode: "insensitive" } },
      { name: { contains: params.search, mode: "insensitive" } }
    ];
  }

  if (
    params.roleFilter === "admin" ||
    params.roleFilter === "teacher" ||
    params.roleFilter === "student"
  ) {
    where.platformRole = params.roleFilter;
  }

  const [users, totalCount] = await Promise.all([
    userRepo.listPaginated({ where, skip, take }),
    userRepo.count(where)
  ]);
  return { users, totalCount, page, totalPages: Math.max(1, Math.ceil(totalCount / take)) };
}

export function countUsers() {
  return userRepo.count();
}

export async function updateUserRole(userId: string, role: "admin" | "teacher" | "student") {
  return userRepo.update(userId, { platformRole: role });
}

export async function toggleUserDisabled(userId: string) {
  const user = await userRepo.findDisabledStatus(userId);
  if (!user) return null;
  return userRepo.update(userId, { disabled: !user.disabled });
}

export interface DashboardStats {
  totalAc: number;
  totalAttempts: number;
  lastSubmittedAt: Date | null;
}

export async function getUserDashboard(userId: string) {
  // Dashboard aggregates stats on-demand from `Submission`. All four
  // reads are independent so they run in parallel.
  const [recentSubmissions, acProblemIds, totalAttempts, mostRecent] = await Promise.all([
    submissionRepo.findRecentByUser(userId, 10),
    submissionRepo.findDistinctAcByUser(userId),
    submissionRepo.count({ userId, sampleOnly: false }),
    submissionRepo.findMostRecent({ userId, sampleOnly: false })
  ]);

  const acIds = acProblemIds.map((s) => s.problemId);
  const acTags = [...new Set(acProblemIds.flatMap((s) => s.problem.tags))];

  const recommendations = await problemRepo.findRecommendations({
    excludeIds: acIds,
    tags: acTags,
    take: 20
  });

  // Randomly pick 3
  const shuffled = recommendations.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, 3);

  const dashboardStats: DashboardStats = {
    totalAc: acIds.length,
    totalAttempts,
    lastSubmittedAt: mostRecent?.createdAt ?? null
  };

  return {
    stats: dashboardStats,
    recentSubmissions,
    recommendations: picked
  };
}

export interface UserAnalytics {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; acCount: number }[];
  byLanguage: { language: string; count: number }[];
  byVerdict: { status: string; count: number }[];
  byTag: { tag: string; acCount: number }[];
}

export async function getUserAnalytics(userId: string): Promise<UserAnalytics> {
  const [acProblems, languageGroups, verdictGroups] = await Promise.all([
    submissionRepo.findDistinctAcByUser(userId),
    submissionRepo.groupByLanguageForUser(userId),
    submissionRepo.groupByStatusForUser(userId)
  ]);

  const difficultyCounts: Record<"easy" | "medium" | "hard", number> = {
    easy: 0,
    medium: 0,
    hard: 0
  };
  for (const row of acProblems) {
    const d = row.problem.difficulty;
    if (d === "easy" || d === "medium" || d === "hard") difficultyCounts[d] += 1;
  }

  return {
    byDifficulty: (["easy", "medium", "hard"] as const).map((d) => ({
      difficulty: d,
      acCount: difficultyCounts[d]
    })),
    byLanguage: languageGroups.map((g) => ({ language: g.language, count: g._count._all })),
    byVerdict: verdictGroups.map((g) => ({ status: g.status, count: g._count._all })),
    byTag: aggregateByTag(acProblems)
  };
}
