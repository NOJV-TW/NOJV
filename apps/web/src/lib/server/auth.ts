import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { type CourseRole, type EffectiveCourseRole, type PlatformRole } from "@nojv/core";

import {
  canEditProblem,
  courseDomain,
  resolveEffectiveCourseRole,
  HttpError,
  NotFoundError,
  ForbiddenError,
} from "@nojv/domain";

export { HttpError, NotFoundError, ForbiddenError };
export { ConflictError } from "@nojv/domain";

export interface ActorContext {
  displayName: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { username: string };

export function getActorContext(event: Pick<RequestEvent, "locals">): ActorContext | null {
  const sessionUser = event.locals.sessionUser;

  if (!sessionUser) {
    return null;
  }

  return {
    displayName: sessionUser.name,
    email: sessionUser.email,
    emailVerified: sessionUser.emailVerified,
    username: sessionUser.username,
    platformRole: sessionUser.platformRole,
    userId: sessionUser.id,
  };
}

export function hasActorUsername<T extends { username: string | null }>(
  actor: T,
): actor is T & { username: string } {
  return typeof actor.username === "string" && actor.username.length > 0;
}

export function requireApiAuth(event: Pick<RequestEvent, "locals">): CompletedActorContext {
  const actor = getActorContext(event);
  if (!actor) throw new HttpError("Authentication required.", 401);
  if (!hasActorUsername(actor)) throw new HttpError("Complete your profile first.", 403);
  return actor;
}

export function requireAuth(
  event: Pick<RequestEvent, "locals">,
  redirectTo?: string,
): CompletedActorContext {
  const actor = getActorContext(event);

  if (!actor) {
    redirect(302, redirectTo ?? "/");
  }

  if (!hasActorUsername(actor)) {
    redirect(302, "/complete-profile");
  }

  return actor;
}

export function requirePlatformRole(actor: ActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}

export function resolveCoursePermissionRole(input: {
  courseRole?: CourseRole | null;
  platformRole: PlatformRole;
}): EffectiveCourseRole | null {
  return resolveEffectiveCourseRole(input.platformRole, input.courseRole ?? null);
}

export async function resolveCoursePermission(courseId: string, actor: ActorContext) {
  const course = await courseDomain.findCourseWithMembership(courseId, actor.userId);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseId}`);
  }

  const membership = course.memberships[0] ?? null;

  return {
    course,
    role: resolveCoursePermissionRole({
      courseRole: membership?.role ?? null,
      platformRole: actor.platformRole,
    }),
  };
}

export async function getCoursePermissionRole(courseId: string, actor: ActorContext) {
  const { role } = await resolveCoursePermission(courseId, actor);
  return role;
}

export function canCreateCourse(platformRole: PlatformRole) {
  return canEditProblem(platformRole);
}

export { canManageCourse as isCourseStaff } from "@nojv/domain";
