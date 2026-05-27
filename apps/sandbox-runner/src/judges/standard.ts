import { compareStandard } from "@nojv/core";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict } from "./run-process.js";

/**
 * Standard judge: run the program with testcase input as stdin, compare
 * normalized stdout with expected output.
 */
export async function judgeStandard(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number,
): Promise<TestcaseResult> {
  const result = await runProcess(runCommand, { stdin: testcase.input, timeoutMs });

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
