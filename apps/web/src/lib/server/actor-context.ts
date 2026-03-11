import { platformRoleSchema, type PlatformRole } from "@nojv/domain";
import type { RequestEvent } from "@sveltejs/kit";

import { readHandleFromAuthUser } from "$lib/auth-onboarding";
import { auth } from "$lib/auth";

export interface ActorContext {
  displayName: string;
  email: string;
  handle: string | null;
  platformRole: PlatformRole;
  userId: string;
}

export type CompletedActorContext = ActorContext & { handle: string };

export async function getActorContext(event: RequestEvent): Promise<ActorContext | null> {
  const session = await auth.api.getSession({
    headers: event.request.headers
  });

  if (!session?.user) {
    return null;
  }

  const extra = session.user as Record<string, unknown>;
  const parsedRole = platformRoleSchema.safeParse(extra.platformRole);

  return {
    displayName: session.user.name,
    email: session.user.email,
    handle: readHandleFromAuthUser(extra),
    platformRole: parsedRole.success ? parsedRole.data : "student",
    userId: session.user.id
  };
}
