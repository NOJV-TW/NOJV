import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import type { CourseMembershipStatus, CourseRole, PlatformRole } from "@nojv/core";

import {
  courseDomain,
  isCourseManager as isCourseManagerFor,
  resolveCourseRole,
  HttpError,
  NotFoundError,
  ForbiddenError,
} from "@nojv/application";

export interface ActorContext {
  displayName: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { username: string };

export function resolveEffectivePlatformRole(
  storedRole: PlatformRole,
  adminAccessActive: boolean,
): PlatformRole {
  if (storedRole === "admin" && !adminAccessActive) return "student";
  return storedRole;
}

export function getActorContext(event: Pick<RequestEvent, "locals">): ActorContext | null {
  if (event.locals.apiTokenActor) {
    return event.locals.apiTokenActor;
  }

  const sessionUser = event.locals.sessionUser;

  if (!sessionUser) {
    return null;
  }

  return {
    displayName: sessionUser.name,
    email: sessionUser.email,
    emailVerified: sessionUser.emailVerified,
    username: sessionUser.username,
    platformRole: resolveEffectivePlatformRole(
      sessionUser.platformRole,
      event.locals.adminAccessActive,
    ),
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

export async function getCoursePermissionRole(courseId: string, actor: ActorContext) {
  const course = await courseDomain.findCourseWithMembership(courseId, actor.userId);

  if (!course) {
    throw new NotFoundError(`Course not found: ${courseId}`);
  }

  return resolveCourseRole(actor.platformRole, course.memberships[0]);
}

interface CourseWithViewerMembership {
  memberships: readonly {
    role: CourseRole;
    status: CourseMembershipStatus;
    userId: string | null;
  }[];
}

function viewerMembership(actor: ActorContext, course: CourseWithViewerMembership) {
  const membership = course.memberships[0];
  return membership?.userId === actor.userId ? membership : null;
}

export function isCourseMember(
  actor: ActorContext,
  course: CourseWithViewerMembership,
): boolean {
  return viewerMembership(actor, course)?.status === "active";
}

export function isCourseManager(
  actor: ActorContext,
  course: CourseWithViewerMembership,
): boolean {
  return isCourseManagerFor(actor.platformRole, viewerMembership(actor, course));
}
