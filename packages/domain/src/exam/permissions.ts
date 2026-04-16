import type { CourseRole, CourseMembershipStatus } from "@nojv/core";

export interface ExamPermissionInput {
  createdByUserId: string | null;
  courseId: string;
}

export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
}

// Pure: callers pre-fetch memberships so the list page can batch-resolve without N+1.
export function canManageExam(
  userId: string | null,
  exam: ExamPermissionInput,
  courseMemberships: CourseMembershipRow[]
): boolean {
  if (userId === null) return false;
  if (exam.createdByUserId === userId) return true;
  return courseMemberships.some(
    (m) =>
      m.courseId === exam.courseId &&
      m.status === "active" &&
      (m.role === "teacher" || m.role === "ta")
  );
}
