import { compareStandard, type RawCaseRun } from "@nojv/core";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict, type RunProcessResult } from "./run-process.js";

function solutionCpuSeconds(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000) + 1;
}

export function toRawCaseRun(result: RunProcessResult, index: number): RawCaseRun {
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
