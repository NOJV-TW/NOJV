import { z } from "zod";

import { submissionJudgeDraftSchema } from "./schemas/submission";

export const submissionJudgeJobSchema = z.object({
  draft: submissionJudgeDraftSchema,
  submissionId: z.string().trim().min(1),
  admissionOrder: z
    .object({ studentId: z.string().min(1), submittedAt: z.number().int().nonnegative() })
    .optional(),
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
