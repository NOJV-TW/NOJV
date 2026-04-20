import type { CourseRole, EffectiveCourseRole, PlatformRole } from "@nojv/core";

/**
 * Resolve the effective course role for a user, considering platform role override.
 * Platform admins always get "admin" effective role regardless of course membership.
 */
export function resolveEffectiveCourseRole(
  platformRole: PlatformRole,
  courseRole: CourseRole | null,
): EffectiveCourseRole | null {
  if (platformRole === "admin") return "admin";
  return courseRole;
}

/**
 * Check whether an effective course role grants course management privileges.
 */
export function canManageCourse(effectiveRole: EffectiveCourseRole | null): boolean {
  return effectiveRole === "admin" || effectiveRole === "teacher" || effectiveRole === "ta";
}

/**
 * Check whether a platform role grants problem editing privileges.
 */
export function canEditProblem(platformRole: PlatformRole): boolean {
  return platformRole === "admin" || platformRole === "teacher";
}
