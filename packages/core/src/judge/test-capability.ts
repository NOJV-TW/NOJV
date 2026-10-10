import type { Language } from "../types";

export function interactiveContestantSupported(language: Language): boolean {
  return language !== "javascript" && language !== "typescript";
}
