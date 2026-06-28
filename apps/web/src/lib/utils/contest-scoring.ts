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

export function contestModeUsesPoints(mode: ContestScoringMode): boolean {
  return mode === "weighted_count" || mode === "point_sum";
}
