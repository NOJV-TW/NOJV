export const USERNAME_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const usernamePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value);
}

export function toggleArrayItem<T>(array: T[], item: T): T[] {
  return array.includes(item) ? array.filter((i) => i !== item) : [...array, item];
}
