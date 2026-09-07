import { z } from "zod";

export const activityTotalPointsSchema = z.coerce
  .number()
  .positive()
  .max(1_000_000_000)
  .multipleOf(0.0001);
export const activityProblemSchema = z.object({
  problemId: z.string().trim().min(1),
  points: z.coerce.number().min(0).max(1_000_000_000).multipleOf(0.00000001),
});
export const activityProblemsSchema = z
  .array(activityProblemSchema)
  .max(64)
  .refine(
    (rows) => new Set(rows.map((row) => row.problemId)).size === rows.length,
    "Each problem may only appear once.",
  );
export const activityGradingUpdateSchema = z.object({
  totalPoints: activityTotalPointsSchema,
  problems: activityProblemsSchema,
  gradingRevision: z.number().int().nonnegative(),
});
export type ActivityProblem = z.infer<typeof activityProblemSchema>;
