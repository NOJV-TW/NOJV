import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { prisma, type TransactionClient } from "@nojv/db";
import { type CourseRole, type EffectiveCourseRole, type PlatformRole } from "@nojv/core";

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
  username: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { username: string };

export function getActorContext(event: RequestEvent): ActorContext | null {
  const sessionUser = event.locals.sessionUser;

  if (!sessionUser) {
    return null;
  }

  return {
    displayName: sessionUser.name,
    email: sessionUser.email,
    username: sessionUser.username,
    platformRole: sessionUser.platformRole,
    userId: sessionUser.id
  };
}

// --- Onboarding helpers ---

export function hasActorUsername<T extends { username: string | null }>(
  actor: T
): actor is T & { username: string } {
  return typeof actor.username === "string" && actor.username.length > 0;
}

// --- Guards ---

/**
 * Require authentication for an API route handler.
 * Throws HttpError (caught by apiHandler) instead of redirecting.
 */
export function requireApiAuth(event: RequestEvent): CompletedActorContext {
  const actor = getActorContext(event);
  if (!actor) throw new HttpError("Authentication required.", 401);
  if (!hasActorUsername(actor)) throw new HttpError("Complete your profile first.", 403);
  return actor;
}

/**
 * Require authentication for a server load function or page.
 * Redirects to the root if not authenticated.
 */
export function requireAuth(event: RequestEvent, redirectTo?: string): CompletedActorContext {
  const actor = getActorContext(event);

  if (!actor) {
    redirect(302, redirectTo ?? "/");
  }

  if (!hasActorUsername(actor)) {
    redirect(302, "/complete-profile");
  }

  return actor;
}

/**
 * Require specific platform roles. Throws ForbiddenError if not matched.
 */
export function requirePlatformRole(actor: ActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
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

export const isCourseStaff = canManageCourse;
export const canManageCourseMembership = canManageCourse;
export const canPublishAssessment = canManageCourse;
export const canViewManagePanel = canManageCourse;
