import { z } from "zod";

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
