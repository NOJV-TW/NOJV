import { z } from "zod";

export const adjustmentRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0),
  }),
  z.object({
    type: z.literal("flat_late_penalty"),
    penaltyPct: z.number().min(0).max(100),
    startFrom: z.enum(["due", "final_day"]).default("due"),
  }),
  z.object({
    type: z.literal("daily_late_penalty"),
    perDayPct: z.number().min(0).max(100),
    startFrom: z.enum(["due", "final_day"]).default("due"),
  }),
  z.object({ type: z.literal("final_day_zero") }),
]);

export type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;

export const adjustmentRulesSchema = z.array(adjustmentRuleSchema).max(10);

export type AdjustmentRules = z.infer<typeof adjustmentRulesSchema>;
