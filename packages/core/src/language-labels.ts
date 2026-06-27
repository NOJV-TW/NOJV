import type { Language } from "./types";

export const LANGUAGE_LABELS: Record<Language, string> = {
  c: "C",
  cpp: "C++",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
  rust: "Rust",
  typescript: "TypeScript",
};

export function languageLabel(lang: Language): string {
  return LANGUAGE_LABELS[lang];
}
