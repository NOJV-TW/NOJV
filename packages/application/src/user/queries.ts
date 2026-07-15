import { runTransaction, submissionRepo, userRepo, type Prisma } from "@nojv/db";

import * as notificationDomain from "../notification";
import { ForbiddenError } from "../shared/errors";

export interface TagAcCount {
  tag: string;
  acCount: number;
}

interface AcRow {
  problem: { tags: string[] };
}

const MAX_TAGS = 20;

export function aggregateByTag(rows: readonly AcRow[]): TagAcCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.problem.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, acCount]) => ({ tag, acCount }))
    .sort((a, b) => b.acCount - a.acCount || a.tag.localeCompare(b.tag))
    .slice(0, MAX_TAGS);
}

export async function getUserById(id: string) {
  return userRepo.findById(id);
}

export async function listUserDisplayNames(
  ids: readonly string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const users = await userRepo.findManyByIds(ids);
  const names: Record<string, string> = {};
  for (const u of users) {
    names[u.id] = u.name;
  }
  return names;
}

export interface UserSearchParams {
  search?: string;
  roleFilter?: string;
  statusFilter?: "active" | "disabled";
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

  if (params.statusFilter === "disabled") {
    where.disabled = true;
  } else if (params.statusFilter === "active") {
    where.disabled = false;
  }

  const [users, totalCount] = await Promise.all([
    userRepo.listPaginated({ where, skip, take }),
    userRepo.count(where),
  ]);
  return { users, totalCount, page, totalPages: Math.max(1, Math.ceil(totalCount / take)) };
}

export async function updateUserRole(
  actorIsSuperAdmin: boolean,
  userId: string,
  role: "admin" | "teacher" | "student",
) {
  return runTransaction(async (tx) => {
    const users = userRepo.withTx(tx);
    const existing = await users.findById(userId);
    const involvesAdmin = role === "admin" || existing?.platformRole === "admin";
    if (involvesAdmin && !actorIsSuperAdmin) {
      throw new ForbiddenError("Only a super admin can grant or remove the admin role.");
    }
    const updated = await users.update(userId, {
      platformRole: role,
      ...(role === "admin" ? {} : { isSuperAdmin: false }),
    });
    if (existing && existing.platformRole !== role) {
      await notificationDomain.createNotificationInTransaction(tx, {
        userId,
        type: "role_changed",
        params: { oldRole: existing.platformRole, newRole: role },
        linkUrl: `/users/${userId}`,
        dedupeKey: `role_changed:${userId}:${updated.updatedAt.toISOString()}`,
      });
    }

    return updated;
  });
}

async function guardDisableTarget(actorIsSuperAdmin: boolean, userId: string) {
  const user = await userRepo.findDisabledStatus(userId);
  if (!user) return null;
  if (user.isSuperAdmin && !actorIsSuperAdmin) {
    throw new ForbiddenError("Only a super admin can disable a super admin.");
  }
  return user;
}

export async function toggleUserDisabled(actorIsSuperAdmin: boolean, userId: string) {
  const user = await guardDisableTarget(actorIsSuperAdmin, userId);
  if (!user) return null;
  return userRepo.update(userId, { disabled: !user.disabled });
}

export async function setUserDisabled(
  actorIsSuperAdmin: boolean,
  userId: string,
  disabled: boolean,
) {
  const user = await guardDisableTarget(actorIsSuperAdmin, userId);
  if (!user) return null;
  return userRepo.update(userId, { disabled });
}

export async function toggleUserAdvancedCreation(userId: string) {
  const user = await userRepo.findById(userId);
  if (!user) return null;
  return userRepo.update(userId, {
    canCreateAdvancedProblems: !user.canCreateAdvancedProblems,
  });
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
