import type { CourseRole, CourseMembershipStatus, PlatformRole } from "@nojv/core";

export interface ContestPermissionInput {
  createdByUserId: string | null;
}

export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
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
