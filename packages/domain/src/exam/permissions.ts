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

/**
 * True when the user may edit the exam, preview problems before start,
 * see draft/archived versions, and run plagiarism checks. Pure —
 * callers pre-fetch memberships so the list page can batch-resolve
 * permissions for many exams without N+1.
 *
 * An exam is always tied to a course, so unlike `canManageContest`
 * (which only checks ownership), exam management includes course
 * teachers and TAs.
 */
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
