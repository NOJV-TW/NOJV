import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

export { DEFAULT_LOCALE } from "@nojv/core";

// Register the project's custom font-size tokens so tailwind-merge stops
// treating e.g. `text-micro` as a text-color and silently dropping it when a
// `text-muted-foreground` follows. See app.css `--text-*` definitions.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "caption",
            "body-sm",
            "body",
            "body-lg",
            "title-sm",
            "title",
            "title-lg",
            "headline",
            "display",
            "display-lg",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// `X-Requested-With: fetch` is required by hooks.server.ts CSRF gate for all
// /api/** mutations except /api/auth. When the body is a string we assume JSON
// (which is true everywhere in this codebase); FormData / URLSearchParams keep
// browser-set Content-Type. Callers can still override either header.
export function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = { "X-Requested-With": "fetch" };
  if (typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  return fetch(input, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
}

export const USERNAME_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const usernamePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value);
}

export const inputClassName =
  "mt-2 w-full rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm";
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
