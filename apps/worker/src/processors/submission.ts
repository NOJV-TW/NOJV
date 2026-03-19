import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";

import type { SubmissionJudgeJob } from "@nojv/core";
import type { SandboxExecutor } from "@nojv/core";

import { activeJobs, submissionDurationSeconds, submissionJobsTotal } from "../metrics.js";
import {
  completeSubmission,
  getSubmissionJudgeContext,
  markSubmissionRunning
} from "../services/judge-db.js";
import { judgeSubmission } from "../services/submission-runner.js";

export function createSubmissionProcessor(executor: SandboxExecutor) {
  return async function processSubmission(job: Job<SubmissionJudgeJob>) {
    const { draft, submissionId } = job.data;
    const language = draft.language;

    activeJobs.inc();
    const timer = submissionDurationSeconds.startTimer({ language });

    try {
      await markSubmissionRunning(submissionId);
      const judgeContext = await getSubmissionJudgeContext(submissionId);

      if (!judgeContext) {
        throw new UnrecoverableError(`Submission context not found for ${submissionId}.`);
      }

      const result = await judgeSubmission(submissionId, draft, judgeContext, executor);
      await completeSubmission(submissionId, result);

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
