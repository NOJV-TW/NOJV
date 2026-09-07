import { z } from "zod";

export const scoreOverrideContextSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.strictObject({ type: z.literal("exam"), examId: z.string().min(1) }),
  z.strictObject({ type: z.literal("contest"), contestId: z.string().min(1) }),
]);

const scoreFields = {
  problemId: z.string().min(1),
  overrideScore: z.number().int().min(0),
  reason: z.string().trim().min(1).max(500),
};

export const scoreOverrideCreateSchema = z.union([
  z.strictObject({
    ...scoreFields,
    context: z.union([
      scoreOverrideContextSchema.options[0],
      scoreOverrideContextSchema.options[1],
    ]),
    courseMembershipId: z.string().min(1),
  }),
  z.strictObject({
    ...scoreFields,
    context: scoreOverrideContextSchema.options[2],
    userId: z.string().min(1),
  }),
]);

export type ScoreOverrideCreateInput = z.infer<typeof scoreOverrideCreateSchema>;
