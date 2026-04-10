import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { DEFAULT_LOCALE } from "@nojv/core";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const USERNAME_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const usernamePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value);
}

export const inputClassName =
  "mt-2 w-full rounded-2xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm";
export const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;

export function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${String(year)}-${month}-${day}T${hours}:${minutes}`;
}

export function toggleArrayItem<T>(array: T[], item: T): T[] {
  return array.includes(item) ? array.filter((i) => i !== item) : [...array, item];
}

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
