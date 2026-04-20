import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict } from "./run-process.js";

/**
 * Canonical OJ output normalization:
 *   - CRLF → LF
 *   - per-line trailing whitespace stripped
 *   - trailing blank lines stripped
 */
function normalize(s: string): string {
  return s
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * Compare standard-judge output against the expected output. Applies the
 * canonical OJ normalization to both sides and tests for exact equality.
 * Float tolerance, case-insensitive matching, and any custom comparison
 * semantics must be implemented as a checker.
 */
export function compareOutputs(actual: string, expected: string): boolean {
  return normalize(actual) === normalize(expected);
}

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
  const verdict = compareOutputs(result.stdout, expected) ? "AC" : "WA";

  return {
    index: testcase.index,
    verdict,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeMs: result.timeMs,
    score: verdict === "AC" ? 100 : 0,
  };
}
