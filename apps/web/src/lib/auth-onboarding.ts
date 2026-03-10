export const HANDLE_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const handlePattern = /^[a-z0-9._-]{3,64}$/;

export function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readHandleFromAuthUser(user: Record<string, unknown>): string | null {
  const handle = readStringValue(user.username);

  return handle && handle.length > 0 ? handle : null;
}

export function readPlatformRole(user: unknown): string {
  return (
    readStringValue((user as Record<string, unknown> | undefined)?.platformRole) ?? "student"
  );
}

export function hasCompletedHandle(user: Record<string, unknown>): boolean {
  return readHandleFromAuthUser(user) !== null;
}

export function hasActorHandle<T extends { handle: string | null }>(
  actor: T
): actor is T & { handle: string } {
  return typeof actor.handle === "string" && actor.handle.length > 0;
}

export function isValidHandle(value: string): boolean {
  return handlePattern.test(value);
}
