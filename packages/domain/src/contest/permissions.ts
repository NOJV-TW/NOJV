import type { CourseRole, CourseMembershipStatus } from "@nojv/core";

export interface ContestPermissionInput {
  createdByUserId: string | null;
}

export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
}

// Contests are standalone — only the creator (or platform admin) can manage; no course-role branch.
export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput
): boolean {
  if (userId === null) return false;
  return contest.createdByUserId === userId;
}
