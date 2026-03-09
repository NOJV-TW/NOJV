import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

export function canCreateCourse(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function canCreateProblem(platformRole: PlatformRole) {
  return platformRole === "admin" || platformRole === "teacher";
}

export function canManageCourseMembership(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canPublishAssessment(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canManageCourseProblems(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}

export function canViewManagePanel(role: EffectiveCourseRole) {
  return role === "admin" || role === "teacher" || role === "ta";
}
