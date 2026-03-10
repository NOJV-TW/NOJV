import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

export function canCreateCourse(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function isCourseStaff(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export const canManageCourseMembership = isCourseStaff;
export const canPublishAssessment = isCourseStaff;
export const canManageCourseProblems = isCourseStaff;
export const canViewManagePanel = isCourseStaff;
