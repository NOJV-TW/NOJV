import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { runProcess, classifySolutionVerdict, parseJudgeOutput } from "./run-process.js";

/** Checker timeout: generous since checkers should be fast. */
const CHECKER_TIMEOUT_MS = 30_000;

/**
 * Checker judge: run the solution, then run the checker script to evaluate.
 *
 * The checker is invoked with three file arguments:
 *   checker <input_file> <expected_file> <user_output_file>
 */
export async function judgeChecker(
  runCommand: string[],
  testcase: TestcaseFiles,
  checkerCommand: string[],
  timeoutMs: number
): Promise<TestcaseResult> {
  // Step 1: Run the solution
  const solution = await runProcess(runCommand, { stdin: testcase.input, timeoutMs });

  const errorVerdict = classifySolutionVerdict(solution, testcase.index);
  if (errorVerdict) return errorVerdict;

  // Step 2: Write temp files for checker
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "checker-"));
  const inputFile = path.join(tmpDir, "stdin.txt");
  const expectedFile = path.join(tmpDir, "expected.txt");
  const userOutputFile = path.join(tmpDir, "user_output.txt");

  try {
    await Promise.all([
      fs.writeFile(inputFile, testcase.input),
      fs.writeFile(expectedFile, testcase.expected ?? ""),
      fs.writeFile(userOutputFile, solution.stdout)
    ]);

    // Step 3: Run checker
    const checkerResult = await runProcess(
      [...checkerCommand, inputFile, expectedFile, userOutputFile],
      { timeoutMs: CHECKER_TIMEOUT_MS }
    );

    // Checker infrastructure failures → SE (not the user's fault)
    if (checkerResult.spawnError) {
      return {
        index: testcase.index,
        verdict: "SE",
        stdout: solution.stdout,
        stderr: `Checker error: ${checkerResult.stderr}`,
        exitCode: solution.exitCode,
        timeMs: solution.timeMs + checkerResult.timeMs,
        feedback: "Checker failed to start (system error)."
      };
    }

    if (checkerResult.timedOut) {
      return {
        index: testcase.index,
        verdict: "SE",
        stdout: solution.stdout,
        stderr: solution.stderr,
        exitCode: solution.exitCode,
        timeMs: solution.timeMs + checkerResult.timeMs,
        feedback: "Checker timed out (system error)."
      };
    }

    // Checker killed by signal (crash) → SE
    if (checkerResult.signal) {
      return {
        index: testcase.index,
        verdict: "SE",
        stdout: solution.stdout,
        stderr: `Checker crashed with signal ${checkerResult.signal}.\n${checkerResult.stderr}`,
        exitCode: solution.exitCode,
        timeMs: solution.timeMs + checkerResult.timeMs,
        feedback: `Checker crashed (${checkerResult.signal}).`
      };
    }

    const parsed = parseJudgeOutput(
      checkerResult.exitCode,
      checkerResult.stdout,
      checkerResult.stderr
    );

    const result: TestcaseResult = {
      index: testcase.index,
      verdict: parsed.accepted ? "AC" : "WA",
      stdout: solution.stdout,
      stderr: solution.stderr,
      exitCode: solution.exitCode,
      timeMs: solution.timeMs + checkerResult.timeMs,
      score: parsed.score
    };
    if (parsed.feedback) {
      result.feedback = parsed.feedback;
    }
    return result;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
