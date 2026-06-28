import type { ContestScoringMode } from "@nojv/core";

import { m } from "$lib/paraglide/messages.js";

export interface ContestScoringOption {
  value: ContestScoringMode;
  label: () => string;
}

export const contestScoringOptions: ContestScoringOption[] = [
  { value: "problem_count", label: m.contestScoring_problemCountLabel },
  { value: "weighted_count", label: m.contestScoring_weightedCountLabel },
  { value: "point_sum", label: m.contestScoring_pointSumLabel },
];

export function contestScoringLabel(mode: ContestScoringMode): string {
  return (
    contestScoringOptions.find((o) => o.value === mode)?.label() ??
    m.contestScoring_pointSumLabel()
  );
}

export function contestScoringModeHelp(): string {
  return m.contestScoring_help();
}

// Only the two solve-count modes (解題數 / 積分制) carry per-problem points that
// the contest manager configures. 累分制 derives its score from subtask judging.
export function contestModeShowsPoints(mode: ContestScoringMode): boolean {
  return mode === "weighted_count" || mode === "point_sum";
}

// 解題數 scores every solved problem as 1, so its per-problem points field is
// meaningless and hidden in the editor.
export function contestModeUsesPointsInput(mode: ContestScoringMode): boolean {
  return mode === "weighted_count" || mode === "point_sum";
}
