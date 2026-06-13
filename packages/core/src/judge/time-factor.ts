import type { Language } from "../types";

export const LANGUAGE_TIME_FACTOR: Record<Language, number> = {
  c: 1,
  cpp: 1,
  rust: 1,
  go: 1.5,
  javascript: 2,
  typescript: 2,
  java: 2,
  python: 3,
};

export function effectiveTimeLimitMs(baseMs: number, language: Language): number {
  return Math.ceil(baseMs * LANGUAGE_TIME_FACTOR[language]);
}
