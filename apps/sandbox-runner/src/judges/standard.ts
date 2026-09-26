import type { RawCaseRun } from "@nojv/core";
import type { TestcaseFiles } from "../types.js";
import { runProcess, classifySolutionVerdict, type RunProcessResult } from "./run-process.js";

export function solutionCpuSeconds(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000) + 1;
}

const OVERFLOW_RESULT_BYTES = 64 * 1024;

export function toRawCaseRun(result: RunProcessResult, index: number): RawCaseRun {
  const errorVerdict = classifySolutionVerdict(result, index)?.verdict as
    "TLE" | "MLE" | "RE" | "SE" | undefined;
  const keep = (text: string) =>
    result.outputLimitExceeded ? text.slice(0, OVERFLOW_RESULT_BYTES) : text;
  return {
    index,
    stdout: keep(result.stdout),
    stderr: keep(result.stderr),
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
  memoryLimitMb: number,
  env?: Record<string, string>,
  cwd?: string,
): Promise<RawCaseRun> {
  const result = await runProcess(runCommand, {
    stdin: testcase.input,
    timeoutMs,
    memoryLimitMb,
    cpuSeconds: solutionCpuSeconds(timeoutMs),
    ...(env ? { env } : {}),
    ...(cwd ? { cwd } : {}),
  });
  return toRawCaseRun(result, testcase.index);
}
