import { hostname } from "node:os";
import { ApplicationFailure, cancellationSignal, heartbeat } from "@temporalio/activity";
import { sandboxOutputSchema, type DeferredStageCleanup, type SandboxResult } from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import { prismaAdapterClient as db } from "@nojv/db";
import { buildSandboxRequest, mapSandboxResult } from "./judge-request";
import { getExecutorOwner } from "./judge";
import { judgeStageRanges } from "../sandbox/kubernetes/job-deadlines";
import {
  recordJudgePhase,
  recordWallClockTimeouts,
} from "../sandbox/shared/judge-phase-metrics";
import { judgeLatencyHistogram, recordJudgeLatency } from "./utils";

export async function judgeExecutionStatus(executionId: string, workflowId: string) {
  const run = await db.judgeExecution.findUniqueOrThrow({
    where: { id: executionId },
    include: { _count: { select: { stages: true } } },
  });
  return {
    state: run.workflowId === workflowId ? run.state : "cancelled",
    stage: run._count.stages,
    reasonCode: run.reasonCode,
    leaseToken: run.workflowId === workflowId ? run.leaseToken : null,
    attempt: run.attempt,
  };
}

export type JudgeStageCleanup = DeferredStageCleanup & { leaseToken: string };

function heartbeatLease(
  executionId: string,
  workflowId: string,
  leaseToken: string,
  details: Record<string, unknown>,
  onLost: () => void,
): () => void {
  heartbeat(details);
  let pending = false;
  const interval = setInterval(() => {
    heartbeat(details);
    if (pending) return;
    pending = true;
    void submissionDomain
      .heartbeatJudgeStage(executionId, workflowId, leaseToken)
      .then((owned) => {
        if (!owned) onLost();
      })
      .catch(onLost)
      .finally(() => {
        pending = false;
      });
  }, 15_000);
  return () => clearInterval(interval);
}

export async function executeJudgeStage(
  executionId: string,
  workflowId: string,
  index: number,
  deferCleanup = false,
) {
  const admission = await submissionDomain.claimJudgeLease(
    executionId,
    workflowId,
    process.env.HOSTNAME ?? hostname(),
  );
  if (admission.status !== "claimed") return admission;
  const { leaseToken } = admission;
  const controller = new AbortController();
  const signal = AbortSignal.any([cancellationSignal(), controller.signal]);
  const stopHeartbeat = heartbeatLease(
    executionId,
    workflowId,
    leaseToken,
    { executionId, index, leaseToken },
    () => controller.abort(),
  );
  let cleanupConfirmed = false;
  const deferred: DeferredStageCleanup[] = [];
  try {
    const { snapshot } = await submissionDomain.loadJudgeExecution(executionId);
    const fullRequest = buildSandboxRequest(snapshot);
    const advanced = fullRequest.problemType === "special_env";
    const ranges = advanced ? [] : judgeStageRanges(fullRequest);
    const total = advanced ? 1 : ranges.length;
    const request = advanced
      ? fullRequest
      : {
          ...fullRequest,
          testcases: fullRequest.testcases.slice(...(ranges[index] ?? [0, 0])),
        };
    if (index >= total) {
      cleanupConfirmed = true;
      await submissionDomain.setJudgeExecutionState(executionId, workflowId, "finalizing");
      return { status: "finished" as const };
    }
    const result = await getExecutorOwner().execute(
      request,
      signal,
      leaseToken,
      deferCleanup ? (cleanup) => deferred.push(cleanup) : undefined,
    );
    const [pendingCleanup] = deferred;
    const systemError =
      Boolean(result.pipelineError) ||
      result.overallVerdict === "SE" ||
      result.testcaseResults.some((c) => c.verdict === "SE") ||
      result.rawRuns?.some((run) => run.errorVerdict === "SE") === true;
    if (pendingCleanup && systemError)
      await getExecutorOwner().cleanupStage(pendingCleanup, signal);
    cleanupConfirmed = !pendingCleanup || systemError;
    if (systemError)
      throw ApplicationFailure.create({
        type: "JudgeResultSystemError",
        message:
          result.pipelineError ??
          "Judge returned SE; retain the original version for recovery.",
        nonRetryable: true,
      });
    recordWallClockTimeouts(result.rawRuns ?? [], request.limits.timeoutMs, request.language);
    const terminal = Boolean(result.compilationError) || index + 1 >= total;
    await submissionDomain.saveJudgeStage(
      executionId,
      workflowId,
      index,
      result,
      leaseToken,
      terminal,
    );
    const status = terminal ? ("finished" as const) : ("saved" as const);
    return pendingCleanup ? { status, cleanup: { ...pendingCleanup, leaseToken } } : { status };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "SandboxBackpressureError",
        "SandboxTransientInfrastructureError",
        "SandboxAdmissionError",
        "SandboxInfeasibleError",
        "SandboxImagePullError",
      ].includes(error.name)
    )
      cleanupConfirmed = true;
    if (error instanceof Error && error.message.length > 2000)
      throw ApplicationFailure.create({
        type: error.name,
        message: error.message.slice(0, 2000),
        nonRetryable: true,
      });
    throw error;
  } finally {
    stopHeartbeat();
    if (cleanupConfirmed)
      await submissionDomain.releaseJudgeStage(executionId, workflowId, leaseToken);
  }
}

export async function cleanupJudgeStage(
  executionId: string,
  workflowId: string,
  cleanup: JudgeStageCleanup,
) {
  const { leaseToken, ...stage } = cleanup;
  const controller = new AbortController();
  const signal = AbortSignal.any([cancellationSignal(), controller.signal]);
  const stopHeartbeat = heartbeatLease(
    executionId,
    workflowId,
    leaseToken,
    { executionId, leaseToken, phase: "cleanup" },
    () => controller.abort(),
  );
  try {
    await getExecutorOwner().cleanupStage(stage, signal);
  } finally {
    stopHeartbeat();
  }
  await submissionDomain.releaseJudgeStage(executionId, workflowId, leaseToken);
}

export async function reconcileJudgeStage(
  executionId: string,
  workflowId: string,
  leaseToken: string,
) {
  const run = await db.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (run.workflowId !== workflowId || run.leaseToken !== leaseToken) return true;
  if (run.leaseUntil && run.leaseUntil.getTime() > Date.now()) return false;
  heartbeat({ executionId, leaseToken, phase: "cleanup" });
  const interval = setInterval(
    () => heartbeat({ executionId, leaseToken, phase: "cleanup" }),
    15_000,
  );
  try {
    const safe = await getExecutorOwner().reconcile(leaseToken, run.leaseOwner ?? undefined);
    if (safe) await submissionDomain.releaseJudgeStage(executionId, workflowId, leaseToken);
    return safe;
  } finally {
    clearInterval(interval);
  }
}

export async function completePinnedJudge(executionId: string, workflowId: string) {
  const { execution, snapshot } = await submissionDomain.loadJudgeExecution(executionId);
  const request = buildSandboxRequest(snapshot);
  const stages = await submissionDomain.readJudgeStages(executionId);
  let combined: SandboxResult = { testcaseResults: [] };
  for (const raw of stages) {
    const stage = sandboxOutputSchema.parse(raw);
    if (stage.compilationError) {
      combined = stage;
      break;
    }
    combined = {
      ...combined,
      ...stage,
      testcaseResults: [...combined.testcaseResults, ...stage.testcaseResults],
      ...(stage.rawRuns ? { rawRuns: [...(combined.rawRuns ?? []), ...stage.rawRuns] } : {}),
    };
  }
  const advanced = request.problemType === "special_env";
  const completed = await submissionDomain.completeJudgeExecution(
    executionId,
    workflowId,
    mapSandboxResult(combined, {
      draft: snapshot.draft,
      context: snapshot.context,
      testcaseCount: request.testcases.length,
    }),
  );
  if (completed) {
    recordJudgeLatency(judgeLatencyHistogram, {
      startedAtMs: execution.createdAt.getTime(),
      completedAtMs: Date.now(),
      mode: advanced ? "advanced" : "standard",
      verdict: completed.status,
    });
    recordJudgePhase(
      "end_to_end",
      Date.now() - execution.createdAt.getTime(),
      advanced ? "advanced" : request.judgeType,
      snapshot.draft.language,
    );
  }
  return completed;
}

export const setJudgeExecutionState = submissionDomain.setJudgeExecutionState;
export const finishJudgeExecution = submissionDomain.finishJudgeExecution;
