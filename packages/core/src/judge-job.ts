import { z } from "zod";

import { submissionDraftSchema } from "./schemas/submission";

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1),
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
