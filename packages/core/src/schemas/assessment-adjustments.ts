import { z } from "zod";

export const latePenaltyRuleSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("flat_late_penalty"),
    penaltyPct: z.number().min(0).max(100),
  }),
  z.strictObject({
    type: z.literal("daily_late_penalty"),
    perDayPct: z.number().min(0).max(100),
  }),
]);

export type LatePenaltyRule = z.infer<typeof latePenaltyRuleSchema>;

export const adjustmentRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("time_bonus"),
    maxBonusPercent: z.number().min(0).max(100),
    baselineMs: z.number().min(0),
  }),
  ...latePenaltyRuleSchema.options,
]);

export type AdjustmentRule = z.infer<typeof adjustmentRuleSchema>;
export const adjustmentRulesSchema = z.array(adjustmentRuleSchema).max(10);
export type AdjustmentRules = z.infer<typeof adjustmentRulesSchema>;

export function extractLatePenalty(raw: unknown): LatePenaltyRule | null {
  if (raw == null) return null;
  return adjustmentRulesSchema.parse(raw).find((rule) => rule.type !== "time_bonus") ?? null;
}

export function refineLateSubmissionWindow(
  value: { dueAt: string; allowLateSubmissions: boolean },
  finalAt: string,
  ctx: z.RefinementCtx,
  finalField: "closesAt" | "endsAt",
): void {
  const due = new Date(value.dueAt).getTime();
  if (!Number.isFinite(due)) {
    ctx.addIssue({ code: "custom", message: "Invalid dueAt", path: ["dueAt"] });
  }
  if (value.allowLateSubmissions) {
    const end = new Date(finalAt).getTime();
    if (!Number.isFinite(end) || end <= due) {
      ctx.addIssue({
        code: "custom",
        message: `${finalField} must be later than dueAt when late submissions are allowed`,
        path: [finalField],
      });
    }
  }
}
