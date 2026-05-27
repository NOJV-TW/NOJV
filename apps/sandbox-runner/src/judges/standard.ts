import { compareStandard, type RawCaseRun } from "@nojv/core";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict, type RunProcessResult } from "./run-process.js";

// CPU-time rlimit headroom over the wall-clock limit: a solution that legitimately
// uses every millisecond of wall time should not be CPU-killed first. The rlimit is
// belt-and-braces against a process that escapes the wall-clock SIGKILL.
function solutionCpuSeconds(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000) + 1;
}

/**
 * Build a raw (undecided) run from a completed process result. Sets
 * `errorVerdict` only when the run failed (TLE/MLE/RE/SE) — AC/WA is decided
 * by the worker, which holds the expected answer. Kept pure so the
 * classification mapping is unit-testable without spawning a process.
 */
export function toRawCaseRun(result: RunProcessResult, index: number): RawCaseRun {
  // `classifySolutionVerdict` only ever returns a failure code (SE/TLE/MLE/RE)
  // or null on success — never AC/WA — so this narrowing is sound.
  const errorVerdict = classifySolutionVerdict(result, index)?.verdict as
    | "TLE"
    | "MLE"
    | "RE"
    | "SE"
    | undefined;
  return {
    index,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    ...(result.memoryKb > 0 ? { memoryKb: result.memoryKb } : {}),
    ...(errorVerdict ? { errorVerdict } : {}),
  };
}

/**
 * Standard mode: run the solution with testcase input as stdin and emit the
 * raw output for worker-side comparison. The expected answer is never shipped
 * into the run container, so the runner cannot (and must not) decide AC/WA.
 */
export async function runSolution(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<RawCaseRun> {
  const result = await runProcess(runCommand, {
    stdin: testcase.input,
    timeoutMs,
    cpuSeconds: solutionCpuSeconds(timeoutMs),
    ...(env ? { env } : {}),
  });
  return toRawCaseRun(result, testcase.index);
}

/**
 * Standard judge (host-side comparison): run the program with testcase input
 * as stdin, compare normalized stdout with expected output. Used by the
 * sandbox-runner integration tests, which run the solution and the comparison
 * in the same process.
 */
export async function judgeStandard(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number,
): Promise<TestcaseResult> {
  const result = await runProcess(runCommand, {
    stdin: testcase.input,
    timeoutMs,
    cpuSeconds: solutionCpuSeconds(timeoutMs),
  });

  const errorVerdict = classifySolutionVerdict(result, testcase.index);
  if (errorVerdict) return errorVerdict;

  const expected = testcase.expected ?? "";
  const verdict = compareStandard(result.stdout, expected) ? "AC" : "WA";

  return {
    index: testcase.index,
    verdict,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    ...(result.memoryKb > 0 ? { memoryKb: result.memoryKb } : {}),
    score: verdict === "AC" ? 100 : 0,
  };
}
