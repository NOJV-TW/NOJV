import type { CourseMembershipRow } from "../shared/permissions";

export interface ExamPermissionInput {
  courseId: string;
}

export function canManageExam(
  userId: string | null,
  exam: ExamPermissionInput,
  courseMemberships: CourseMembershipRow[],
): boolean {
  if (userId === null) return false;
  return courseMemberships.some(
    (m) =>
      m.courseId === exam.courseId &&
      m.status === "active" &&
      (m.role === "teacher" || m.role === "ta"),
  );
}
