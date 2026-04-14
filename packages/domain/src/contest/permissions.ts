import type { CourseRole, CourseMembershipStatus } from "@nojv/core";

export interface ContestPermissionInput {
  createdByUserId: string | null;
}

// Re-exported for call sites that still reason about course
// memberships via the shared shape. The exam permission module uses
// the same alias so the frontend can import one type.
export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
}

/**
 * True when the user may edit the contest, preview problems before start,
 * and see draft/archived versions.
 *
 * Contests are standalone — the course-role branch moved to
 * `canManageExam`. Only the creator (or platform admin, handled at a
 * higher layer) may manage a contest now.
 */
export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput
): boolean {
  if (userId === null) return false;
  return contest.createdByUserId === userId;
}
