import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess } from "./run-process.js";

/**
 * Normalize program output for comparison:
 * - Convert \r\n → \n
 * - Trim trailing whitespace/newlines from the end of the entire output
 *
 * Matches the normalization used in the existing submission-runner.
 */
function normalizeOutput(output: string): string {
  return output.replaceAll("\r\n", "\n").trimEnd();
}

/**
 * Standard judge: run the program with testcase input as stdin,
 * compare normalized stdout with expected output.
 */
export async function judgeStandard(
  runCommand: string[],
  testcase: TestcaseFiles,
  timeoutMs: number
): Promise<TestcaseResult> {
  const result = await runProcess(runCommand, { stdin: testcase.input, timeoutMs });

  if (result.spawnError) {
    return {
      index: testcase.index,
      verdict: "SE",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timeMs: result.timeMs
    };
  }

  if (result.timedOut) {
    return {
      index: testcase.index,
      verdict: "TLE",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timeMs: result.timeMs
    };
  }

  // MLE: killed by external SIGKILL (e.g. OOM killer) before timeout
  if (result.signal === "SIGKILL") {
    return {
      index: testcase.index,
      verdict: "MLE",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timeMs: result.timeMs
    };
  }

  // RE: non-zero exit code
  if (result.exitCode !== 0) {
    return {
      index: testcase.index,
      verdict: "RE",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timeMs: result.timeMs
    };
  }

  // Compare output
  const expected = testcase.expected ?? "";
  const verdict = normalizeOutput(result.stdout) === normalizeOutput(expected) ? "AC" : "WA";

  return {
    index: testcase.index,
    verdict,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    score: verdict === "AC" ? 100 : 0
  };
}
