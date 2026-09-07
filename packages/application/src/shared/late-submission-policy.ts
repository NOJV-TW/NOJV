import { adjustmentRulesSchema } from "@nojv/core";

import { ValidationError } from "./errors";

export function assertLateSubmissionPolicy(
  rules: unknown,
  dueAt: Date | null,
  end: Date,
  scoringMode?: string,
): void {
  const parsed = adjustmentRulesSchema.parse(rules ?? []);
  const lateRules = parsed.filter((rule) => rule.type !== "time_bonus");
  if (lateRules.length > 1) {
    throw new ValidationError("Choose only one late penalty.");
  }
  if (lateRules.length > 0 && (!dueAt || dueAt >= end)) {
    throw new ValidationError("Late penalties require a final collection time after dueAt.");
  }
  if (
    scoringMode &&
    parsed.length > 0 &&
    (scoringMode !== "point_sum" || parsed.some((rule) => rule.type === "time_bonus"))
  ) {
    throw new ValidationError("Exam late penalties require point_sum scoring.");
  }
}
