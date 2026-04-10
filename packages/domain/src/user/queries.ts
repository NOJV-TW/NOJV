import { problemRepo, submissionRepo, userRepo, type Prisma } from "@nojv/db";

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
  // The `UserStats` denorm row was removed in the second-pass refactor —
  // the dashboard aggregates stats on-demand from `Submission`. All four
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
