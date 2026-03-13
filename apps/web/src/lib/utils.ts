import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---

/** Default locale for database content (problem statements, user locale, etc.). */
export const DEFAULT_LOCALE = "zh-TW";

// --- Username validation ---

export const USERNAME_INPUT_PATTERN = "[a-z0-9._-]{3,64}";
const usernamePattern = /^[a-z0-9._-]{3,64}$/;

export function isValidUsername(value: string): boolean {
  return usernamePattern.test(value);
}

// --- Shared form class names ---

export const inputClassName =
  "mt-2 w-full rounded-2xl border border-border bg-white/60 px-3 py-3 text-sm";
export const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;

// --- UI component type helpers (shadcn/svelte) ---

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
