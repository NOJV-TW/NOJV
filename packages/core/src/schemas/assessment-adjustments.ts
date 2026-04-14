import { z } from "zod";

/**
 * Assessment / contest adjustment rules.
 *
 * The course experience redesign (2026-04-14) swapped the old
 * `late_penalty_fixed` / `late_penalty_decay` / `memory_penalty`
 * variants for three classroom-oriented late-penalty modes plus the
 * existing `time_bonus`:
 *
 *   - `time_bonus`         — unchanged; linearly rewards fast runtimes.
 *   - `flat_late_penalty`  — one-shot percentage deduction if late.
 *   - `daily_late_penalty` — linear per-day percentage deduction.
 *   - `final_day_zero`     — hard gate: zero the score past the final day.
 *
 * `flat_late_penalty` and `daily_late_penalty` anchor on either the
 * assessment's soft `dueAt` or the hard `closesAt` ("final day").
 */
export const adjustmentRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0)
  }),
  z.object({
    type: z.literal("flat_late_penalty"),
    penaltyPct: z.number().min(0).max(100),
    startFrom: z.enum(["due", "final_day"]).default("due")
  }),
  z.object({
    type: z.literal("daily_late_penalty"),
    perDayPct: z.number().min(0).max(100),
    startFrom: z.enum(["due", "final_day"]).default("due")
  }),
  z.object({ type: z.literal("final_day_zero") })
]);

export type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;

export const adjustmentRulesSchema = z.array(adjustmentRuleSchema).max(10);

export type AdjustmentRules = z.infer<typeof adjustmentRulesSchema>;
