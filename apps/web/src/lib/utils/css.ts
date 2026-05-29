import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

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

export const inputClassName =
  "mt-2 w-full rounded-xl border border-border bg-[color:var(--color-panel)] px-3 py-3 text-sm";
export const monoTextareaClassName = `${inputClassName} min-h-24 resize-y font-mono`;

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
