import { contestRepo } from "@nojv/db";
import type { PlatformRole } from "@nojv/core";

export interface ContestPermissionInput {
  createdByUserId: string | null;
}

// Contests are standalone — creator OR platform admin can manage. Course-role
// teaching rights do not transfer (contests have no course parent).
export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput,
  platformRole?: PlatformRole | null,
): boolean {
  if (userId === null) return false;
  if (platformRole === "admin") return true;
  return contest.createdByUserId === userId;
}

/**
 * Returns true when the viewer is allowed to see the unfrozen (live) and
 * not-yet-revealed scoreboard rows. Admins and the contest organizer
 * qualify; everyone else — including teachers / TAs of unrelated courses
 * — gets the frozen view. The check loads the contest row exactly once
 * and is safe to call repeatedly within a single request.
 */
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
