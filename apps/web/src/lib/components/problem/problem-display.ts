import { m } from "$lib/paraglide/messages.js";
import type { ProblemDifficulty, ProblemType } from "@nojv/core";

export type Difficulty = "all" | ProblemDifficulty;
export const difficulties: Difficulty[] = ["all", "easy", "medium", "hard"];

export function renderProblemType(type: ProblemType): string {
  switch (type) {
    case "full_source":
      return m.problemDetail_fullSourceBadge();
    case "multi_file":
      return m.problemDetail_multiFileBadge();
    case "special_env":
      return m.problemDetail_specialEnvBadge();
  }
}

export function renderJudgeMethod(type: ProblemType, judgeType: string): string {
  if (type === "special_env") return "—";
  switch (judgeType) {
    case "checker":
      return m.problemDetail_checkerBadge();
    case "interactive":
      return m.problemDetail_interactiveBadge();
    default:
      return m.problemDetail_standardBadge();
  }
}

export function formatAcceptanceRate(value: number, totalSubmissions: number): string {
  if (totalSubmissions === 0) return "—";
  return `${String(Math.round(value * 100))}%`;
}

interface FilterableProblem {
  difficulty: ProblemDifficulty;
  id: string;
  tags: string[];
  title: string;
}

export function filterProblems<T extends FilterableProblem>(
  problems: T[],
  search: string,
  difficulty: Difficulty,
  selectedTags: Set<string>,
): T[] {
  const query = search.toLowerCase();
  return problems.filter((p) => {
    if (query && !p.title.toLowerCase().includes(query)) return false;
    if (difficulty !== "all" && p.difficulty !== difficulty) return false;
    if (selectedTags.size > 0 && ![...selectedTags].every((tag) => p.tags.includes(tag))) {
      return false;
    }
    return true;
  });
}
