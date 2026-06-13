import { contestRepo } from "@nojv/db";
import type { PlatformRole } from "@nojv/core";

export interface ContestPermissionInput {
  createdByUserId: string | null;
}

export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput,
  platformRole?: PlatformRole | null,
): boolean {
  if (userId === null) return false;
  if (platformRole === "admin") return true;
  return contest.createdByUserId === userId;
}

export async function canViewLiveContestScoreboard(
  contestId: string,
  actor: { userId: string; platformRole: PlatformRole | null } | null,
): Promise<boolean> {
  if (actor == null) return false;
  if (actor.platformRole === "admin") return true;
  const contest = await contestRepo.findById(contestId);
  if (!contest) return false;
  return contest.createdByUserId === actor.userId;
}
