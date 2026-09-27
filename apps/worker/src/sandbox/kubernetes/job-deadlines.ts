import {
  COMPILATION_TIMEOUT_MS,
  executionWallTimeLimitMs,
  INTERACTIVE_STAGE_CASES,
  JUDGE_STAGE_CASES,
  validatorTimeoutMs,
  type SandboxRequest,
} from "@nojv/core";

const JOB_DEADLINE_FLOOR_SECONDS = 120;
const JOB_DEADLINE_CAP_SECONDS = 1_800;
const JOB_DEADLINE_BUFFER_SECONDS = 60;
const STAGE_PAYLOAD_BYTES = 64 * 1024 * 1024;

function uncappedJobDeadlineSeconds(executionBudgetMs: number): number {
  return (
    Math.ceil((COMPILATION_TIMEOUT_MS + executionBudgetMs) / 1000) + JOB_DEADLINE_BUFFER_SECONDS
  );
}

function computePreparedJobDeadlineSeconds(executionBudgetMs: number): number {
  return Math.min(
    Math.max(uncappedJobDeadlineSeconds(executionBudgetMs), JOB_DEADLINE_FLOOR_SECONDS),
    JOB_DEADLINE_CAP_SECONDS,
  );
}

function stageBudgetMs(request: SandboxRequest, cases: number): number {
  const runMs = executionWallTimeLimitMs(request.limits.timeoutMs) * cases;
  const judgeMs =
    request.judgeType === "checker"
      ? COMPILATION_TIMEOUT_MS +
        executionWallTimeLimitMs(validatorTimeoutMs(request.limits.timeoutMs)) * cases
      : 0;
  return runMs + judgeMs;
}

export function computeStageJobDeadlineSeconds(request: SandboxRequest): number {
  return computePreparedJobDeadlineSeconds(
    stageBudgetMs(request, Math.max(1, request.testcases.length)),
  );
}

export function judgeStageRanges(request: SandboxRequest): [number, number][] {
  const maxCases =
    request.judgeType === "interactive" ? INTERACTIVE_STAGE_CASES : JUDGE_STAGE_CASES;
  const ranges: [number, number][] = [];
  let start = 0;
  let bytes = 0;
  request.testcases.forEach((testcase, index) => {
    const size = Buffer.byteLength(testcase.input) + Buffer.byteLength(testcase.output ?? "");
    const cases = index - start;
    if (
      cases > 0 &&
      (cases >= maxCases ||
        bytes + size > STAGE_PAYLOAD_BYTES ||
        uncappedJobDeadlineSeconds(stageBudgetMs(request, cases + 1)) >
          JOB_DEADLINE_CAP_SECONDS)
    ) {
      ranges.push([start, index]);
      start = index;
      bytes = 0;
    }
    bytes += size;
  });
  ranges.push([start, request.testcases.length]);
  return ranges;
}

export function computeInteractiveJobDeadlineSeconds(request: SandboxRequest): number {
  const perCase = Math.max(
    executionWallTimeLimitMs(request.limits.timeoutMs),
    validatorTimeoutMs(request.limits.timeoutMs),
  );
  return computePreparedJobDeadlineSeconds(perCase * Math.max(1, request.testcases.length));
}
