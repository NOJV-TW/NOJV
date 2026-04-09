import { z } from "zod";

/**
 * Assessment-level score adjustment rules.
 *
 * In the Phase 1 redesign these rules move from per-problem
 * `judgeConfig.scoring.adjustmentRules` to per-assessment (CourseAssessment)
 * and per-contest (Contest) configuration. A given assessment or contest
 * applies its own rules uniformly across all problems it contains.
 *
 * The shape of each rule is unchanged from the legacy `scoringRuleSchema`
 * so that the Phase 1 data migration script can lift rules as-is.
 */
export const adjustmentRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("late_penalty_fixed"),
    perUnit: z.enum(["day", "week"]),
    amount: z.number().min(0).max(100),
    maxDeduction: z.number().min(0).max(100)
  }),
  z.object({
    type: z.literal("late_penalty_decay"),
    halfLifeHours: z.number().min(1).max(8760)
  }),
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0)
  }),
  z.object({
    type: z.literal("memory_penalty"),
    thresholdMb: z.number().min(0),
    maxDeduction: z.number().min(0).max(100)
  })
]);

export type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;

export const adjustmentRulesSchema = z.array(adjustmentRuleSchema).max(10);

export type AdjustmentRules = z.infer<typeof adjustmentRulesSchema>;
