import { redirect } from "next/navigation";
import { headers } from "next/headers";

import type { EffectiveCourseRole, PlatformRole } from "@nojv/domain";
import { platformRoleSchema } from "@nojv/domain";

import { auth } from "@/lib/auth";
import type { PocActorContext } from "../actor-context";
import { ForbiddenError } from "../api-errors";
import { getCoursePermissionRole } from "./roles";

/**
 * Require authentication for a server component page.
 * Redirects to sign-in if not authenticated.
 */
export async function requireAuth(redirectTo?: string): Promise<PocActorContext> {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session?.user) {
    redirect(redirectTo ?? "/auth/signin");
  }

  const extra = session.user as Record<string, unknown>;
  const parsedRole = platformRoleSchema.safeParse(extra.platformRole);

  return {
    displayName: session.user.name ?? session.user.email,
    email: session.user.email,
    handle: (extra.handle as string) ?? "",
    platformRole: parsedRole.success ? parsedRole.data : "student",
    userId: session.user.id
  };
}

/**
 * Require specific platform roles. Throws ForbiddenError if not matched.
 */
export function requirePlatformRole(actor: PocActorContext, ...roles: PlatformRole[]): void {
  if (!roles.includes(actor.platformRole)) {
    throw new ForbiddenError("Insufficient platform role.");
  }
}

/**
 * Require specific course roles. Returns the resolved role.
 * Throws ForbiddenError if user has no role or role is not in the allowed list.
 */
export async function requireCourseRole(
  actor: PocActorContext,
  courseSlug: string,
  ...roles: EffectiveCourseRole[]
): Promise<EffectiveCourseRole> {
  const role = await getCoursePermissionRole(courseSlug, actor);

  if (!role || !roles.includes(role)) {
    throw new ForbiddenError("Insufficient course role.");
  }

  return role;
}
