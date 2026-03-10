import { redirect } from "next/navigation";
import { headers } from "next/headers";

import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";

import type { ActorContext, CompletedActorContext } from "../actor-context";
import { getActorContext } from "../actor-context";
import { ForbiddenError } from "../api-errors";
import { getCoursePermissionRole } from "./roles";

function getLocaleFromHeaders(hdrs: Headers): string {
  const pathname = hdrs.get("x-pathname") ?? "";
  const match = pathname.match(/^\/([a-z-]+)\//);
  return match?.[1] ?? "zh-TW";
}

/**
 * Require authentication for a server component page.
 * Redirects to sign-in if not authenticated.
 */
export async function requireAuth(redirectTo?: string): Promise<CompletedActorContext> {
  const actor = await getActorContext();
  const hdrs = await headers();
  const locale = getLocaleFromHeaders(hdrs);

  if (!actor) {
    redirect(redirectTo ?? `/${locale}`);
  }

  if (!actor.handle) {
    redirect(`/${locale}/auth/complete-profile`);
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
