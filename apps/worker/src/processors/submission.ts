import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";

import { submissionJudgeJobSchema, type SubmissionJudgeJob } from "@nojv/queue";
import type { SandboxExecutor } from "@nojv/sandbox";

import { activeJobs, submissionDurationSeconds, submissionJobsTotal } from "../metrics.js";
import { completeSubmission, getSubmissionJudgeContext, markSubmissionRunning } from "../services/judge-db.js";
import { judgeSubmission } from "../services/submission-runner.js";

export function createSubmissionProcessor(executor: SandboxExecutor) {
  return async function processSubmission(job: Job<SubmissionJudgeJob>) {
    const payload = submissionJudgeJobSchema.parse(job.data);
    const language = payload.draft.language;

    activeJobs.inc();
    const timer = submissionDurationSeconds.startTimer({ language });

    try {
      await markSubmissionRunning(payload.submissionId);
      const judgeContext = await getSubmissionJudgeContext(payload.submissionId);

      if (!judgeContext) {
        throw new UnrecoverableError(`Submission context not found for ${payload.submissionId}.`);
      }

      const result = await judgeSubmission(
        payload.submissionId,
        payload.draft,
        judgeContext,
        executor
      );
      await completeSubmission(payload.submissionId, result);

      timer({ verdict: result.verdict });
      submissionJobsTotal.inc({ status: "completed", language });
      activeJobs.dec();

      return result;
    } catch (error) {
      timer({ verdict: "error" });
      submissionJobsTotal.inc({ status: "failed", language });
      activeJobs.dec();
      throw error;
    }
  };
}
