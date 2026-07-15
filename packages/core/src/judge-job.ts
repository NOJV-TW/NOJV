import { z } from "zod";

import { submissionJudgeDraftSchema } from "./schemas/submission";

export const submissionJudgeJobSchema = z.object({
  draft: submissionJudgeDraftSchema,
  submissionId: z.string().trim().min(1),
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
