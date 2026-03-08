import { platformRoleSchema, type PlatformRole } from "@nojv/domain";

import { auth } from "@/auth";

export interface PocActorContext {
  displayName: string;
  email: string;
  handle: string;
  platformRole: PlatformRole;
  userId: string;
}

const defaultActorContext: PocActorContext = {
  displayName: "Learner 01",
  email: "learner.01@nojv.local",
  handle: "learner_01",
  platformRole: "student",
  userId: "usr_student_local"
};

function readHeader(headers: Headers, key: string) {
  const value = headers.get(key)?.trim();

  return value && value.length > 0 ? value : undefined;
}

function deriveEmail(userId: string) {
  return `${userId.replaceAll(/[^a-z0-9._-]/gi, "-").toLowerCase()}@nojv.local`;
}

function deriveHandle(userId: string) {
  return userId.replaceAll(/[^a-z0-9._-]/gi, "-").toLowerCase();
}

function getActorContextFromHeaders(request: Request): PocActorContext {
  const userId = readHeader(request.headers, "x-nojv-actor-id") ?? defaultActorContext.userId;
  const parsedRole = platformRoleSchema.safeParse(
    readHeader(request.headers, "x-nojv-platform-role") ?? defaultActorContext.platformRole
  );
  const platformRole = parsedRole.success ? parsedRole.data : defaultActorContext.platformRole;

  return {
    displayName: readHeader(request.headers, "x-nojv-display-name") ?? userId,
    email: readHeader(request.headers, "x-nojv-email") ?? deriveEmail(userId),
    handle: readHeader(request.headers, "x-nojv-handle") ?? deriveHandle(userId),
    platformRole,
    userId
  };
}

export async function getActorContext(request: Request): Promise<PocActorContext> {
  const session = await auth();

  if (session?.user?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = session.user as any;
    const parsedRole = platformRoleSchema.safeParse(u.platformRole);

    return {
      displayName: session.user.name ?? session.user.email ?? "User",
      email: session.user.email ?? "",
      handle: (u.handle as string) ?? "",
      platformRole: parsedRole.success ? parsedRole.data : "student",
      userId: session.user.id
    };
  }

  // Header-based fallback is only allowed in development
  if (process.env.NODE_ENV === "development") {
    return getActorContextFromHeaders(request);
  }

  return defaultActorContext;
}
