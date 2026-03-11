import type { Job } from "bullmq";

import { completeSubmission, getSubmissionJudgeContext, markSubmissionRunning } from "@nojv/db";
import { submissionJudgeJobSchema, type SubmissionJudgeJob } from "@nojv/queue";

import type { SandboxExecutor } from "../services/sandbox-executor.js";
import { judgeSubmission } from "../services/submission-runner.js";

export function createSubmissionProcessor(executor: SandboxExecutor) {
  return async function processSubmission(job: Job<SubmissionJudgeJob>) {
    const payload = submissionJudgeJobSchema.parse(job.data);

    await markSubmissionRunning(payload.submissionId);
    const judgeContext = await getSubmissionJudgeContext(payload.submissionId);

    if (!judgeContext) {
      throw new Error(`Submission context not found for ${payload.submissionId}.`);
    }

    const result = await judgeSubmission(
      payload.submissionId,
      payload.draft,
      judgeContext,
      executor
    );
    await completeSubmission(payload.submissionId, result);

    return result;
  };
}
