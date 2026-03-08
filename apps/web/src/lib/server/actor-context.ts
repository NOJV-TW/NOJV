import { platformRoleSchema, type PlatformRole } from "@nojv/domain";

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

export function getActorContext(request: Request): PocActorContext {
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
