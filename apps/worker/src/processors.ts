import type { Job } from "bullmq";

import {
  completeSubmission,
  completeWorkspaceRun,
  getSubmissionJudgeContext,
  markSubmissionRunning,
  markWorkspaceRunRunning
} from "@nojv/db";
import {
  cheatingSignalSchema,
  integrityAssessmentSchema,
  workspaceRunResultSchema,
  type CheatingSignal,
  type WorkspaceRunRequest,
  type WorkspaceRunResult
} from "@nojv/domain";
import {
  submissionJudgeJobSchema,
  type SubmissionJudgeJob,
  type WorkspaceRunJob,
  workspaceRunJobSchema
} from "@nojv/queue";

import { parseWorkerEnv } from "./env";
import { executeEphemeralWorkspaceRun } from "./services/ephemeral-workspace";
import { evaluateIntegritySignals } from "./services/integrity-score";
import { runRemoteSandboxCommand } from "./services/remote-sandbox";
import {
  buildJudgeWorkspaceRequest,
  judgeSubmissionAgainstTestcases
} from "./services/submission-runner";

const environment = parseWorkerEnv(process.env);

function getRemoteSandboxConfig() {
  if (environment.EXECUTION_BACKEND !== "remote_http") {
    return null;
  }

  if (!environment.SANDBOX_BASE_URL || !environment.SANDBOX_SHARED_TOKEN) {
    throw new Error(
      "Remote sandbox execution requires SANDBOX_BASE_URL and SANDBOX_SHARED_TOKEN."
    );
  }

  return {
    baseUrl: environment.SANDBOX_BASE_URL,
    sharedToken: environment.SANDBOX_SHARED_TOKEN
  };
}

function getLocalSandboxOptions() {
  return {
    sandboxCpuLimit: environment.SANDBOX_CPU_LIMIT,
    sandboxImage: environment.SANDBOX_IMAGE,
    sandboxMemoryMb: environment.SANDBOX_MEMORY_MB,
    sandboxPidsLimit: environment.SANDBOX_PIDS_LIMIT
  } as const;
}

async function executeJudgeRun(
  input: Parameters<typeof buildJudgeWorkspaceRequest>[0],
  remoteSandboxConfig: ReturnType<typeof getRemoteSandboxConfig>
) {
  const request = buildJudgeWorkspaceRequest(input);

  if (remoteSandboxConfig) {
    return runRemoteSandboxCommand(request, remoteSandboxConfig);
  }

  return executeEphemeralWorkspaceRun(request, {
    ...getLocalSandboxOptions(),
    sandboxMemoryMb: input.memoryLimitMb
  });
}

async function executeRawRun(
  request: WorkspaceRunRequest,
  remoteSandboxConfig: ReturnType<typeof getRemoteSandboxConfig>
) {
  if (remoteSandboxConfig) {
    return runRemoteSandboxCommand(request, remoteSandboxConfig);
  }

  return executeEphemeralWorkspaceRun(request, getLocalSandboxOptions());
}

export async function processSubmission(job: Job<SubmissionJudgeJob>) {
  const payload = submissionJudgeJobSchema.parse(job.data);
  const remoteSandboxConfig = getRemoteSandboxConfig();

  await markSubmissionRunning(payload.submissionId);
  const judgeContext = await getSubmissionJudgeContext(payload.submissionId);

  if (!judgeContext) {
    throw new Error(`Submission context not found for ${payload.submissionId}.`);
  }

  const result = await judgeSubmissionAgainstTestcases(
    {
      checkerScript: judgeContext.checkerScript,
      draft: payload.draft,
      interactorScript: judgeContext.interactorScript,
      judgeType: judgeContext.judgeType,
      memoryLimitMb: judgeContext.memoryLimitMb,
      submissionType: judgeContext.submissionType,
      templates: judgeContext.templates,
      testcases: judgeContext.testcases,
      timeLimitMs: judgeContext.timeLimitMs
    },
    {
      executeRun: async (request) => {
        return executeRawRun(request, remoteSandboxConfig);
      },
      runSolution: async (input) => {
        return executeJudgeRun(input, remoteSandboxConfig);
      }
    }
  );
  await completeSubmission(payload.submissionId, result);

  return result;
}

export async function processWorkspaceRun(job: Job<WorkspaceRunJob>) {
  const payload = workspaceRunJobSchema.parse(job.data);
  const remoteSandboxConfig = getRemoteSandboxConfig();

  await markWorkspaceRunRunning(payload.workspaceRunId);
  const result: WorkspaceRunResult = remoteSandboxConfig
    ? await runRemoteSandboxCommand(payload.request, remoteSandboxConfig)
    : workspaceRunResultSchema.parse(
        await executeEphemeralWorkspaceRun(payload.request, getLocalSandboxOptions())
      );
  await completeWorkspaceRun(payload.workspaceRunId, result);

  return result;
}

export function processCheatingSignal(job: Job<CheatingSignal>) {
  const payload = cheatingSignalSchema.parse(job.data);

  return Promise.resolve(integrityAssessmentSchema.parse(evaluateIntegritySignals([payload])));
}
