import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";

import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import type { ActorContext, CompletedActorContext } from "../actor-context";
import { getActorContext } from "../actor-context";
import { ForbiddenError } from "../api-errors";
import { getCoursePermissionRole } from "./roles";

function getLocaleFromUrl(url: URL): string {
  const match = /^\/([a-z-]+)\//.exec(url.pathname);
  return match?.[1] ?? "zh-TW";
}

/**
 * Require authentication for a server load function or page.
 * Redirects to the locale root if not authenticated.
 */
export async function requireAuth(event: RequestEvent, redirectTo?: string): Promise<CompletedActorContext> {
  const actor = await getActorContext(event);
  const locale = getLocaleFromUrl(event.url);

  if (!actor) {
    redirect(302, redirectTo ?? `/${locale}`);
  }

  if (!actor.handle) {
    redirect(302, `/${locale}/auth/complete-profile`);
  }

  return actor as CompletedActorContext;
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
