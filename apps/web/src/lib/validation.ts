export const HANDLE_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const handlePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidHandle(value: string): boolean {
  return handlePattern.test(value);
}

export function readPlatformRole(user: { platformRole?: string } | null | undefined): string {
  return user?.platformRole ?? "student";
}
