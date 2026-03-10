import type { Job } from "bullmq";

import {
  completeSubmission,
  getSubmissionJudgeContext,
  markSubmissionRunning
} from "@nojv/db";
import {
  cheatingSignalSchema,
  integrityAssessmentSchema,
  type CheatingSignal
} from "@nojv/domain";
import {
  submissionJudgeJobSchema,
  type SubmissionJudgeJob
} from "@nojv/queue";

import { parseWorkerEnv } from "./env";
import { DockerExecutor } from "./services/docker-executor.js";
import { evaluateIntegritySignals } from "./services/integrity-score";
import { K8sExecutor } from "./services/k8s-executor.js";
import type { SandboxExecutor } from "./services/sandbox-executor.js";
import { judgeSubmission } from "./services/submission-runner.js";

const environment = parseWorkerEnv(process.env);

function createExecutor(): SandboxExecutor {
  if (environment.EXECUTION_BACKEND === "kubernetes") {
    return new K8sExecutor({
      namespace: environment.K8S_NAMESPACE,
      image: environment.SANDBOX_IMAGE,
      cpuRequest: environment.K8S_CPU_REQUEST,
      cpuLimit: environment.K8S_CPU_LIMIT,
      memoryRequest: environment.K8S_MEMORY_REQUEST,
      memoryLimit: environment.K8S_MEMORY_LIMIT,
    });
  }
  return new DockerExecutor({
    cpuLimit: environment.SANDBOX_CPU_LIMIT,
    image: environment.SANDBOX_IMAGE,
    memoryMb: environment.SANDBOX_MEMORY_MB,
    pidsLimit: environment.SANDBOX_PIDS_LIMIT,
  });
}

const executor = createExecutor();

export async function processSubmission(job: Job<SubmissionJudgeJob>) {
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
    executor,
  );
  await completeSubmission(payload.submissionId, result);

  return result;
}

export function processCheatingSignal(job: Job<CheatingSignal>) {
  const payload = cheatingSignalSchema.parse(job.data);

  return Promise.resolve(integrityAssessmentSchema.parse(evaluateIntegritySignals([payload])));
}
