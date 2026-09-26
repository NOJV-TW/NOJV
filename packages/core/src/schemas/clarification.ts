import { z } from "zod";

export const clarificationContextSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assignment"), assignmentId: z.string().min(1) }),
  z.object({ type: z.literal("exam"), examId: z.string().min(1) }),
  z.object({ type: z.literal("contest"), contestId: z.string().min(1) }),
]);

export const clarificationListQuerySchema = z.object({
  context: clarificationContextSchema,
  since: z.iso.datetime().optional(),
});

export const clarificationCreateSchema = z.object({
  context: clarificationContextSchema,
  problemId: z.string().min(1).optional().nullable(),
  questionText: z.string().min(10).max(1000),
});

export const clarificationPatchSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    answerText: z.string().min(1).max(1000),
    isPublic: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal("dismiss"),
  }),
]);

export const clarificationCannedReplySchema = z.object({
  templateKey: z.enum(["noComment", "readProblem", "yes", "no"]),
});

export type ClarificationPatchInput = z.infer<typeof clarificationPatchSchema>;
