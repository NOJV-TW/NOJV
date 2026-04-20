import { submissionRepo, userRepo, type Prisma } from "@nojv/db";
import { aggregateByTag } from "./analytics-helpers";
import * as notificationDomain from "../notification";

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
      { name: { contains: params.search, mode: "insensitive" } },
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
    userRepo.count(where),
  ]);
  return { users, totalCount, page, totalPages: Math.max(1, Math.ceil(totalCount / take)) };
}

export async function updateUserRole(userId: string, role: "admin" | "teacher" | "student") {
  // Read the current role before writing so we can detect a no-op and
  // avoid generating a role_changed bell entry for an admin re-applying
  // the same role.
  const existing = await userRepo.findById(userId);
  const updated = await userRepo.update(userId, { platformRole: role });

  if (existing && existing.platformRole !== role) {
    await notificationDomain.createNotification({
      userId,
      type: "role_changed",
      params: { oldRole: existing.platformRole, newRole: role },
      linkUrl: "/account",
    });
  }

  return updated;
}

export async function toggleUserDisabled(userId: string) {
  const user = await userRepo.findDisabledStatus(userId);
  if (!user) return null;
  return userRepo.update(userId, { disabled: !user.disabled });
}

export interface DashboardStats {
  totalAc: number;
  totalAttempts: number;
}

export interface UserAnalytics {
  byDifficulty: { difficulty: "easy" | "medium" | "hard"; acCount: number }[];
  byLanguage: { language: string; count: number }[];
  byVerdict: { status: string; count: number }[];
  byTag: { tag: string; acCount: number }[];
}

export interface DashboardView {
  stats: DashboardStats;
  recentSubmissions: Awaited<ReturnType<typeof submissionRepo.findRecentByUser>>;
  analytics: UserAnalytics;
}

export async function getDashboardView(userId: string): Promise<DashboardView> {
  const [recentSubmissions, acProblems, totalAttempts, languageGroups, verdictGroups] =
    await Promise.all([
      submissionRepo.findRecentByUser(userId, 10),
      submissionRepo.findDistinctAcByUser(userId),
      submissionRepo.count({ userId, sampleOnly: false }),
      submissionRepo.groupByLanguageForUser(userId),
      submissionRepo.groupByStatusForUser(userId),
    ]);

  const difficultyCounts: Record<"easy" | "medium" | "hard", number> = {
    easy: 0,
    medium: 0,
    hard: 0,
  };
  for (const row of acProblems) {
    difficultyCounts[row.problem.difficulty] += 1;
  }

  const analytics: UserAnalytics = {
    byDifficulty: (["easy", "medium", "hard"] as const).map((d) => ({
      difficulty: d,
      acCount: difficultyCounts[d],
    })),
    byLanguage: languageGroups.map((g) => ({ language: g.language, count: g._count._all })),
    byVerdict: verdictGroups.map((g) => ({ status: g.status, count: g._count._all })),
    byTag: aggregateByTag(acProblems),
  };

  return {
    stats: { totalAc: acProblems.length, totalAttempts },
    recentSubmissions,
    analytics,
  };
}
