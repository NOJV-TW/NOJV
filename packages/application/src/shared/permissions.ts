import type {
  CourseMembershipStatus,
  CourseRole,
  EffectiveCourseRole,
  PlatformRole,
} from "@nojv/core";
import { courseMembershipRepo, type TransactionClient } from "@nojv/db";

import { ForbiddenError } from "./errors";

export interface CourseMembershipRow {
  courseId: string;
  role: CourseRole;
  status: CourseMembershipStatus;
}

export type CourseMembershipGrant = Pick<CourseMembershipRow, "role" | "status">;

export interface CourseAuthorityActor {
  platformRole: PlatformRole;
  userId: string;
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

export function resolveCourseRole(
  platformRole: PlatformRole,
  membership: CourseMembershipGrant | null | undefined,
): EffectiveCourseRole | null {
  return resolveEffectiveCourseRole(
    platformRole,
    membership?.status === "active" ? membership.role : null,
  );
}

export function isActiveCourseStaff(membership: CourseMembershipGrant | null | undefined) {
  return membership?.status === "active" && canManageCourse(membership.role);
}

export function isCourseManager(
  platformRole: PlatformRole,
  membership: CourseMembershipGrant | null | undefined,
): boolean {
  return canManageCourse(resolveCourseRole(platformRole, membership));
}

export async function getCourseRole(
  actor: CourseAuthorityActor,
  courseId: string,
  tx?: TransactionClient,
): Promise<EffectiveCourseRole | null> {
  if (actor.platformRole === "admin") return "admin";
  const repo = tx ? courseMembershipRepo.withTx(tx) : courseMembershipRepo;
  return resolveCourseRole(
    actor.platformRole,
    await repo.findByComposite(courseId, actor.userId),
  );
}

export async function assertCourseManager(
  actor: CourseAuthorityActor,
  courseId: string,
  tx?: TransactionClient,
): Promise<EffectiveCourseRole> {
  const role = await getCourseRole(actor, courseId, tx);
  if (!role || !canManageCourse(role)) {
    throw new ForbiddenError("You do not have permission to manage this course.");
  }
  return role;
}

export function canCreateCourse(platformRole: PlatformRole): boolean {
  return platformRole === "admin" || platformRole === "teacher";
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

export async function isCourseStaff(userId: string, courseId: string): Promise<boolean> {
  return isActiveCourseStaff(await courseMembershipRepo.findByComposite(courseId, userId));
}

export async function isCourseStaffTx(
  tx: TransactionClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  return isActiveCourseStaff(
    await courseMembershipRepo.withTx(tx).findByComposite(courseId, userId),
  );
}
