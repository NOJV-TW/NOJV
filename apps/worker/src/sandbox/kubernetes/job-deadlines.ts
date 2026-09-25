import {
  COMPILATION_TIMEOUT_MS,
  executionWallTimeLimitMs,
  validatorTimeoutMs,
  type SandboxRequest,
} from "@nojv/core";

const JOB_DEADLINE_FLOOR_SECONDS = 120;
const JOB_DEADLINE_CAP_SECONDS = 1_800;
const JOB_DEADLINE_BUFFER_SECONDS = 60;

function computePreparedJobDeadlineSeconds(executionBudgetMs: number): number {
  const compute =
    Math.ceil((COMPILATION_TIMEOUT_MS + executionBudgetMs) / 1000) +
    JOB_DEADLINE_BUFFER_SECONDS;
  return Math.min(Math.max(compute, JOB_DEADLINE_FLOOR_SECONDS), JOB_DEADLINE_CAP_SECONDS);
}

export function computeStageJobDeadlineSeconds(request: SandboxRequest): number {
  const cases = Math.max(1, request.testcases.length);
  const runMs = executionWallTimeLimitMs(request.limits.timeoutMs) * cases;
  const judgeMs =
    request.judgeType === "checker"
      ? COMPILATION_TIMEOUT_MS +
        executionWallTimeLimitMs(validatorTimeoutMs(request.limits.timeoutMs)) * cases
      : 0;
  return computePreparedJobDeadlineSeconds(runMs + judgeMs);
}

export function computeInteractiveJobDeadlineSeconds(request: SandboxRequest): number {
  const perCase = Math.max(
    executionWallTimeLimitMs(request.limits.timeoutMs),
    validatorTimeoutMs(request.limits.timeoutMs),
  );
  return computePreparedJobDeadlineSeconds(perCase * Math.max(1, request.testcases.length));
}
