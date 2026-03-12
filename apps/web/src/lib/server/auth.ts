import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { prisma, type TransactionClient } from "@nojv/db";
import {
  platformRoleSchema,
  type CourseRole,
  type EffectiveCourseRole,
  type PlatformRole
} from "@nojv/core";

import {
  canEditProblem,
  canManageCourse,
  resolveEffectiveCourseRole
} from "./shared/permissions";

// --- Error classes ---

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found.") {
    super(message, 404);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Resource already exists.") {
    super(message, 409);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden.") {
    super(message, 403);
  }
}

// --- Actor context ---

export interface ActorContext {
  displayName: string;
  email: string;
  handle: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { handle: string };

export function getActorContext(event: RequestEvent): ActorContext | null {
  const user = event.locals.user;

  if (!user) {
    return null;
  }

  const extra = user as Record<string, unknown>;
  const parsedRole = platformRoleSchema.safeParse(extra.platformRole);

  return {
    displayName: user.name,
    email: user.email,
    handle: readHandleFromAuthUser(extra),
    platformRole: parsedRole.success ? parsedRole.data : "student",
    userId: user.id
  };
}

// --- Onboarding helpers ---

export { HANDLE_INPUT_PATTERN, isValidHandle, readPlatformRole } from "$lib/validation";

export function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readHandleFromAuthUser(user: Record<string, unknown>): string | null {
  const handle = readStringValue(user.username);

  return handle && handle.length > 0 ? handle : null;
}

export function hasCompletedHandle(user: Record<string, unknown>): boolean {
  return readHandleFromAuthUser(user) !== null;
}

export function hasActorHandle<T extends { handle: string | null }>(
  actor: T
): actor is T & { handle: string } {
  return typeof actor.handle === "string" && actor.handle.length > 0;
}

export { isReservedHandle } from "$lib/school";

// --- Guards ---

/**
 * Require authentication for a server load function or page.
 * Redirects to the root if not authenticated.
 */
export async function requireAuth(
  event: RequestEvent,
  redirectTo?: string
): Promise<CompletedActorContext> {
  const actor = getActorContext(event);

  if (!actor) {
    redirect(302, redirectTo ?? "/");
  }

  if (!hasActorHandle(actor)) {
    redirect(302, "/complete-profile");
  }

  return await Promise.resolve(actor);
}

/**
 * Require specific platform roles. Throws ForbiddenError if not matched.
 */
export function requirePlatformRole(actor: ActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}

/**
 * Require specific course roles. Returns the resolved role.
 * Throws ForbiddenError if user has no role or role is not in the allowed list.
 */
export async function requireCourseRole(
  actor: ActorContext,
  courseSlug: string,
  ...roles: EffectiveCourseRole[]
): Promise<EffectiveCourseRole> {
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !roles.includes(role)) {
    throw new ForbiddenError("Insufficient course role.");
  }

  return role;
}

// --- Course role resolution ---

export function resolveCoursePermissionRole(input: {
  courseRole?: CourseRole | null;
  platformRole: PlatformRole;
}): EffectiveCourseRole | null {
  return resolveEffectiveCourseRole(input.platformRole, input.courseRole ?? null);
}

export async function resolveCoursePermission(
  tx: TransactionClient,
  courseSlug: string,
  actor: ActorContext
) {
  const course = await tx.course.findUnique({
    where: { slug: courseSlug },
    include: {
      memberships: {
        where: { userId: actor.userId },
        take: 1
      }
    }
  });

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseSlug}`);
  }

  const membership = course.memberships[0] ?? null;

  return {
    course,
    role: resolveCoursePermissionRole({
      courseRole: membership?.role ?? null,
      platformRole: actor.platformRole
    })
  };
}

export async function getCoursePermissionRole(courseSlug: string, actor: ActorContext) {
  const { role } = await resolveCoursePermission(prisma, courseSlug, actor);
  return role;
}

// --- Permission checks ---

export function canCreateCourse(platformRole: PlatformRole) {
  return canEditProblem(platformRole);
}

export function isCourseStaff(role: EffectiveCourseRole) {
  return canManageCourse(role);
}

export const canManageCourseMembership = isCourseStaff;
export const canPublishAssessment = isCourseStaff;
export const canManageCourseProblems = isCourseStaff;
export const canViewManagePanel = isCourseStaff;
