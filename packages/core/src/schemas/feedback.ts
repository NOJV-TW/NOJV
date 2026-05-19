import { z } from "zod";

export const feedbackUpsertSchema = z.object({
  studentUserId: z.string().min(1),
  problemId: z.string().min(1),
  comment: z.string().trim().min(1).max(2000),
});

export type FeedbackUpsertInput = z.infer<typeof feedbackUpsertSchema>;
