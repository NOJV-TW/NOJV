import { hostname } from "node:os";
import { ApplicationFailure, cancellationSignal, heartbeat } from "@temporalio/activity";
import {
  JUDGE_STAGE_CASES,
  sandboxOutputSchema,
  submissionResultSchema,
  type SandboxResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import { prismaAdapterClient as db } from "@nojv/db";
import { buildPinnedSandboxRequest } from "./judge-request";
import { getExecutorOwner } from "./judge";
import { enforceMemoryLimit } from "../services/check-standard";
import { recordJudgePhase, recordWallClockTimeouts } from "../services/judge-phase-metrics";
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

export async function executeJudgeStage(
  executionId: string,
  workflowId: string,
  index: number,
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
  heartbeat({ executionId, index, leaseToken });
  let heartbeatPending = false;
  const interval = setInterval(() => {
    heartbeat({ executionId, index, leaseToken });
    if (heartbeatPending) return;
    heartbeatPending = true;
    void submissionDomain
      .heartbeatJudgeStage(executionId, workflowId, leaseToken)
      .then((owned) => {
        if (!owned) controller.abort();
      })
      .catch(() => controller.abort())
      .finally(() => {
        heartbeatPending = false;
      });
  }, 15_000);
  let cleanupConfirmed = false;
  try {
    const { snapshot } = await submissionDomain.loadJudgeExecution(executionId);
    const fullRequest = buildPinnedSandboxRequest(snapshot);
    const advanced = fullRequest.problemType === "special_env";
    const total = advanced
      ? 1
      : Math.max(1, Math.ceil(fullRequest.testcases.length / JUDGE_STAGE_CASES));
    const request = advanced
      ? fullRequest
      : {
          ...fullRequest,
          testcases: fullRequest.testcases.slice(
            index * JUDGE_STAGE_CASES,
            (index + 1) * JUDGE_STAGE_CASES,
          ),
        };
    if (index >= total) {
      cleanupConfirmed = true;
      return { status: "finished" as const };
    }
    await submissionDomain.setJudgeExecutionState(executionId, workflowId, "running");
    const result = await getExecutorOwner().execute(request, signal, leaseToken);
    cleanupConfirmed = true;
    if (
      result.pipelineError ||
      result.overallVerdict === "SE" ||
      result.testcaseResults.some((c) => c.verdict === "SE") ||
      result.rawRuns?.some((run) => run.errorVerdict === "SE")
    )
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
    return { status: terminal ? ("finished" as const) : ("saved" as const) };
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
    clearInterval(interval);
    if (cleanupConfirmed)
      await submissionDomain.releaseJudgeStage(executionId, workflowId, leaseToken);
  }
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
  const request = buildPinnedSandboxRequest(snapshot);
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
  combined.testcaseResults = enforceMemoryLimit(
    combined.testcaseResults,
    snapshot.context.runtime.memoryLimitMb,
  );
  const advanced = request.problemType === "special_env";
  const result = submissionDomain.mapResult(
    combined,
    snapshot.draft.sampleOnly || advanced ? [] : snapshot.context.testcaseSets,
    snapshot.context,
    advanced ? undefined : request.testcases.length,
  );
  if (snapshot.draft.sampleOnly) result.score = 0;
  const completed = await submissionDomain.completeJudgeExecution(
    executionId,
    workflowId,
    submissionResultSchema.parse(result),
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
