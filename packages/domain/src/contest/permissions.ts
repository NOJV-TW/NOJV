import type { CourseRole, CourseMembershipStatus } from "@nojv/core";

export type ContestPermissionInput = {
  createdByUserId: string;
  courseId: string | null;
};

export type CourseMembershipRow = {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
};

/**
 * True when the user may edit the contest, preview problems before start,
 * and see draft/archived versions. Used by detail page, problem solve page,
 * and the list page tab classifier.
 *
 * Pure — callers must fetch memberships and pass them in. This lets the
 * list page batch-resolve permissions for many contests without N+1.
 */
export function canManageContest(
  userId: string | null,
  contest: ContestPermissionInput,
  courseMemberships: CourseMembershipRow[]
): boolean {
  if (userId === null) return false;
  if (contest.createdByUserId === userId) return true;
  if (contest.courseId === null) return false;
  return courseMemberships.some(
    (m) =>
      m.courseId === contest.courseId &&
      m.status === "active" &&
      (m.role === "teacher" || m.role === "ta")
  );
}
