import {
  cheatingSignalSchema,
  submissionDraftSchema,
  type CheatingSignal
} from "@nojv/domain";
import { z } from "zod";

export const queueNames = {
  cheatingSignal: "cheating-signal",
  submission: "submission-judge"
} as const;

export const defaultJobOptions = {
  attempts: 3,
  removeOnComplete: 250,
  removeOnFail: 500
} as const;

export const submissionJudgeJobSchema = z.object({
  draft: submissionDraftSchema,
  submissionId: z.string().trim().min(1)
});

export type SubmissionJudgeJob = z.infer<typeof submissionJudgeJobSchema>;

export interface QueueEnvelope<TName extends string, TData> {
  data: TData;
  name: TName;
}

export function createSubmissionJob(
  payload: SubmissionJudgeJob
): QueueEnvelope<(typeof queueNames)["submission"], SubmissionJudgeJob> {
  return {
    data: submissionJudgeJobSchema.parse(payload),
    name: queueNames.submission
  };
}

export function createCheatingSignalJob(
  payload: CheatingSignal
): QueueEnvelope<(typeof queueNames)["cheatingSignal"], CheatingSignal> {
  return {
    data: cheatingSignalSchema.parse(payload),
    name: queueNames.cheatingSignal
  };
}
