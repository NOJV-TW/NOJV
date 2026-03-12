import { submissionDraftSchema } from "@nojv/core";
import { z } from "zod";

export const defaultJobOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: false
} as const;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;
