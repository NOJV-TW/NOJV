import {
  languageSchema,
  validateRequiredPaths,
  type AdvancedJudgeVerificationSnapshot,
  type RejudgeInput,
  type SubmissionJudgeDraft,
  type SubmissionResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import { cancellationSignal, heartbeat } from "@temporalio/activity";

import { recordJudgePhase } from "../sandbox/shared/judge-phase-metrics";
import type { ExecutorOwner } from "../sandbox/shared/executor-owner";
import { buildSandboxRequest, mapSandboxResult } from "./judge-request";
import { judgeLatencyHistogram, recordJudgeLatency } from "./utils";

const JUDGE_HEARTBEAT_INTERVAL_MS = 15_000;

type BatchRejudgeInput = Extract<RejudgeInput, { mode: "batch" }>;

let _executorOwner: ExecutorOwner | undefined;

export function setExecutorOwner(executorOwner: ExecutorOwner): void {
  _executorOwner = executorOwner;
}

export function getExecutorOwner(): ExecutorOwner {
  if (!_executorOwner) throw new Error("Executor owner not initialized");
  return _executorOwner;
}

export async function fetchJudgeContext(
  submissionId: string,
): Promise<submissionDomain.JudgeDispatchMeta> {
  return submissionDomain.getJudgeDispatchMeta(submissionId);
}

function systemErrorResult(feedback: string): SubmissionResult {
  return {
    accepted: false,
    verdict: "system_error",
    score: 0,
    runtimeMs: 0,
    caseResults: [],
    feedback,
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionJudgeDraft,
  runId?: string,
): Promise<{
  result: SubmissionResult;
  advancedJudgeVerificationSnapshot: AdvancedJudgeVerificationSnapshot | null;
}> {
  const sources = await submissionDomain.getSubmissionSources(submissionId);
  if (sources.length === 0) {
    return {
      result: systemErrorResult(
        "Submission sources missing from storage; marked as system_error.",
      ),
      advancedJudgeVerificationSnapshot: null,
    };
  }

  const context = await submissionDomain.getJudgeContext(submissionId);
  const advancedJudgeVerificationSnapshot = context.advanced
    ? {
        config: context.advanced.config,
        requiredPaths: context.advanced.requiredPaths,
        resourceLimits: context.advanced.resourceLimits,
      }
    : null;

  if (context.advanced && context.advanced.requiredPaths.length > 0) {
    const requiredPaths = validateRequiredPaths(
      sources.map((source) => source.path),
      context.advanced.requiredPaths,
    );
    if (!requiredPaths.ok) {
      return {
        result: systemErrorResult(
          `Submission no longer satisfies the Advanced required paths: ${requiredPaths.errors
            .map((issue) => issue.path)
            .join(", ")}`,
        ),
        advancedJudgeVerificationSnapshot,
      };
    }
  }

  const request = buildSandboxRequest({ submissionId, draft, context, sources });
  heartbeat("sandbox-started");
  const heartbeatTimer = setInterval(
    () => heartbeat("sandbox-running"),
    JUDGE_HEARTBEAT_INTERVAL_MS,
  );
  try {
    const result = await getExecutorOwner().execute(request, cancellationSignal(), runId);
    return {
      result: mapSandboxResult(result, {
        draft,
        context,
        testcaseCount: request.testcases.length,
      }),
      advancedJudgeVerificationSnapshot,
    };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function completeSubmission(
  submissionId: string,
  judgeRunId: string,
  result: SubmissionResult,
  mode: "standard" | "advanced",
  advancedConfig: AdvancedJudgeVerificationSnapshot | null = null,
): Promise<submissionDomain.CompletedSubmission | null> {
  const completed = await submissionDomain.completeJudge(
    submissionId,
    judgeRunId,
    result,
    advancedConfig,
  );
  if (!completed) return null;
  recordJudgeLatency(judgeLatencyHistogram, {
    startedAtMs: completed.createdAt.getTime(),
    completedAtMs: Date.now(),
    mode,
    verdict: completed.status,
  });
  const language = languageSchema.safeParse(completed.language);
  if (language.success)
    recordJudgePhase(
      "end_to_end",
      Date.now() - completed.createdAt.getTime(),
      mode,
      language.data,
    );
  return completed;
}

export async function fetchSubmissionIdsForRejudge(input: BatchRejudgeInput): Promise<
  {
    submissionId: string;
    studentId: string;
    judgeGeneration: number;
    draft: SubmissionJudgeDraft;
  }[]
> {
  const targets = await submissionDomain.listForRejudge({
    problemId: input.problemId,
    ...(input.contestId ? { contestId: input.contestId } : {}),
    ...(input.assessmentId ? { assignmentId: input.assessmentId } : {}),
    ...(input.examId ? { examId: input.examId } : {}),
    ...(input.userIds ? { userIds: input.userIds } : {}),
    ...(input.since ? { since: new Date(input.since) } : {}),
    ...(input.until ? { until: new Date(input.until) } : {}),
  });
  return targets;
}

export async function fetchSingleSubmissionForRejudge(submissionId: string): Promise<{
  submissionId: string;
  studentId: string;
  draft: SubmissionJudgeDraft;
} | null> {
  return submissionDomain.findOneForRejudge(submissionId);
}

export async function snapshotSubmissionForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
  rejudgeRunId: string,
  expectedJudgeGeneration: number | null,
): Promise<{ logId: string; oldStatus: string } | null> {
  return submissionDomain.snapshotForRejudge(
    submissionId,
    triggeredByUserId,
    rejudgeRunId,
    expectedJudgeGeneration,
  );
}

export async function finalizeRejudgeLog(
  submissionId: string,
  triggeredByUserId: string | null,
  logId: string,
  judgeRunId: string,
): Promise<void> {
  return submissionDomain.finalizeRejudgeLog(
    submissionId,
    triggeredByUserId,
    logId,
    judgeRunId,
  );
}

export async function restoreSubmissionForCancelledRejudge(
  submissionId: string,
  judgeRunId: string,
  oldStatus: string,
): Promise<void> {
  return submissionDomain.restoreSubmissionAfterCancelledRejudge(
    submissionId,
    judgeRunId,
    oldStatus,
  );
}

export async function startSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
): Promise<void> {
  await submissionDomain.startSubmissionJudgeRun(submissionId, judgeRunId);
}

export async function failSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
  reason: string,
): Promise<boolean> {
  return submissionDomain.failSubmissionJudgeRun(submissionId, judgeRunId, reason);
}

export async function cleanupSandboxRun(runId: string): Promise<void> {
  await getExecutorOwner().cleanupRun(runId);
}
export {
  judgeExecutionStatus,
  executeJudgeStage,
  reconcileJudgeStage,
  completePinnedJudge,
  setJudgeExecutionState,
  finishJudgeExecution,
} from "./judge-execution";
