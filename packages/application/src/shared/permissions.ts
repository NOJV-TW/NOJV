import type {
  CourseMembershipStatus,
  CourseRole,
  EffectiveCourseRole,
  PlatformRole,
} from "@nojv/core";

export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
}

export function resolveEffectiveCourseRole(
  platformRole: PlatformRole,
  courseRole: CourseRole | null,
): EffectiveCourseRole | null {
  if (platformRole === "admin") return "admin";
  return courseRole;
}

export function canManageCourse(effectiveRole: EffectiveCourseRole | null): boolean {
  return effectiveRole === "admin" || effectiveRole === "teacher" || effectiveRole === "ta";
}

export function canManageMembers(effectiveRole: EffectiveCourseRole | null): boolean {
  return effectiveRole === "admin" || effectiveRole === "teacher";
}

export function canEditProblem(platformRole: PlatformRole): boolean {
  return platformRole === "admin" || platformRole === "teacher";
}

export function canCreateProblem(platformRole: PlatformRole, emailVerified: boolean): boolean {
  if (canEditProblem(platformRole)) return true;
  return emailVerified;
}
