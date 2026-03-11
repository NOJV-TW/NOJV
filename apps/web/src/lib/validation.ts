export const HANDLE_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const handlePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidHandle(value: string): boolean {
  return handlePattern.test(value);
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readPlatformRole(user: unknown): string {
  return (
    readStringValue((user as Record<string, unknown> | undefined)?.platformRole) ?? "student"
  );
}
