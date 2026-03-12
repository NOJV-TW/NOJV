import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TestcaseFiles, TestcaseResult } from "../types.js";

/**
 * Run the solution process and capture its output.
 */
function runSolution(
  runCommand: string[],
  stdin: string,
  timeoutMs: number
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  timedOut: boolean;
  memoryExceeded: boolean;
  spawnError: boolean;
}> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = runCommand;

    if (!cmd) {
      resolve({
        stdout: "",
        stderr: "Empty run command.",
        exitCode: -1,
        timeMs: 0,
        timedOut: false,
        memoryExceeded: false,
        spawnError: true
      });
      return;
    }

    const proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    proc.stdin.on("error", () => {}); // Ignore EPIPE when process exits before stdin is consumed
    proc.stdin.write(stdin);
    proc.stdin.end();

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, timeoutMs + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - startTime);
      const isTimedOut = killed || signal === "SIGTERM" || timeMs >= timeoutMs;
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? -1,
        timeMs,
        timedOut: isTimedOut,
        memoryExceeded: !isTimedOut && signal === "SIGKILL",
        spawnError: false
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `Failed to spawn process: ${err.message}`,
        exitCode: -1,
        timeMs: Math.round(performance.now() - startTime),
        timedOut: false,
        memoryExceeded: false,
        spawnError: true
      });
    });
  });
}

/**
 * Parse checker exit code and stdout to determine verdict and score.
 *
 * Protocol (matching existing submission-runner):
 * - Exit code 0 → accepted
 * - Exit code non-zero → rejected
 * - Checker stdout: integer 0-100 (score), defaults to 100 if accepted, 0 if rejected
 * - Checker stderr: feedback message
 */
function parseCheckerOutput(
  exitCode: number,
  stdout: string,
  stderr: string
): { accepted: boolean; score: number; feedback: string } {
  const accepted = exitCode === 0;
  const feedback = stderr.trim();

  const scoreText = stdout.trim();
  let score: number;
  if (scoreText.length > 0) {
    const parsed = parseInt(scoreText, 10);
    score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : accepted ? 100 : 0;
  } else {
    score = accepted ? 100 : 0;
  }

  return { accepted, score, feedback };
}

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
  const solution = await runSolution(runCommand, testcase.input, timeoutMs);

  if (solution.spawnError) {
    return {
      index: testcase.index,
      verdict: "SE",
      stdout: solution.stdout,
      stderr: solution.stderr,
      exitCode: solution.exitCode,
      timeMs: solution.timeMs
    };
  }

  if (solution.timedOut) {
    return {
      index: testcase.index,
      verdict: "TLE",
      stdout: solution.stdout,
      stderr: solution.stderr,
      exitCode: solution.exitCode,
      timeMs: solution.timeMs
    };
  }

  if (solution.memoryExceeded) {
    return {
      index: testcase.index,
      verdict: "MLE",
      stdout: solution.stdout,
      stderr: solution.stderr,
      exitCode: solution.exitCode,
      timeMs: solution.timeMs
    };
  }

  if (solution.exitCode !== 0) {
    return {
      index: testcase.index,
      verdict: "RE",
      stdout: solution.stdout,
      stderr: solution.stderr,
      exitCode: solution.exitCode,
      timeMs: solution.timeMs
    };
  }

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
    const checkerResult = await runChecker(
      checkerCommand,
      inputFile,
      expectedFile,
      userOutputFile
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
    if (checkerResult.signalName) {
      return {
        index: testcase.index,
        verdict: "SE",
        stdout: solution.stdout,
        stderr: `Checker crashed with signal ${checkerResult.signalName}.\n${checkerResult.stderr}`,
        exitCode: solution.exitCode,
        timeMs: solution.timeMs + checkerResult.timeMs,
        feedback: `Checker crashed (${checkerResult.signalName}).`
      };
    }

    const parsed = parseCheckerOutput(
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

/** Checker timeout: generous since checkers should be fast. */
const CHECKER_TIMEOUT_MS = 30_000;

/**
 * Run the checker process with the three standard file arguments.
 * Uses a fixed checker timeout independent of the solution timeout.
 */
function runChecker(
  checkerCommand: string[],
  inputFile: string,
  expectedFile: string,
  userOutputFile: string
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  timedOut: boolean;
  signalName: string | null;
  spawnError: boolean;
}> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = checkerCommand;

    if (!cmd) {
      resolve({
        stdout: "",
        stderr: "Empty checker command.",
        exitCode: -1,
        timeMs: 0,
        timedOut: false,
        signalName: null,
        spawnError: true
      });
      return;
    }

    const proc = spawn(cmd, [...args, inputFile, expectedFile, userOutputFile], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CHECKER_TIMEOUT_MS
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, CHECKER_TIMEOUT_MS + 500);

    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      const timeMs = Math.round(performance.now() - startTime);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? -1,
        timeMs,
        timedOut: killed || signal === "SIGTERM" || timeMs >= CHECKER_TIMEOUT_MS,
        signalName: signal,
        spawnError: false
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: `Failed to spawn checker: ${err.message}`,
        exitCode: -1,
        timeMs: Math.round(performance.now() - startTime),
        timedOut: false,
        signalName: null,
        spawnError: true
      });
    });
  });
}
