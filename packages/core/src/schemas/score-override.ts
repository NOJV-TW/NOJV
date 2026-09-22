import { z } from "zod";

export const scoreOverrideContextSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.strictObject({ type: z.literal("exam"), examId: z.string().min(1) }),
]);

export const scoreOverrideCreateSchema = z.strictObject({
  problemId: z.string().min(1),
  overrideScore: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500),
  context: scoreOverrideContextSchema,
  courseMembershipId: z.string().min(1),
});

export type ScoreOverrideCreateInput = z.infer<typeof scoreOverrideCreateSchema>;
