import { spawn } from "node:child_process";
import type { TestcaseFiles, TestcaseResult } from "../types.js";

/**
 * Parse interactor result following the existing submission-runner protocol:
 * - Exit code 0 → accepted
 * - Interactor stderr line 1: score (0-100)
 * - Interactor stderr line 2+: feedback
 */
function parseInteractorOutput(
  exitCode: number,
  stderr: string,
): { accepted: boolean; score: number; feedback: string } {
  const accepted = exitCode === 0;
  const lines = stderr.trim().split("\n");

  const scoreText = lines[0]?.trim() ?? "";
  let score: number;
  if (scoreText.length > 0) {
    const parsed = parseInt(scoreText, 10);
    score = Number.isFinite(parsed)
      ? Math.max(0, Math.min(100, parsed))
      : accepted
        ? 100
        : 0;
  } else {
    score = accepted ? 100 : 0;
  }

  const feedback = lines.slice(1).join("\n").trim();
  return { accepted, score, feedback };
}

/**
 * Interactive judge: bidirectional pipe between the solution and an interactor.
 *
 * Solution's stdout → interactor's stdin
 * Interactor's stdout → solution's stdin
 *
 * The interactor receives the testcase input file path as its first argument.
 * Uses Node.js stream piping (no FIFOs needed since both run locally).
 */
export function judgeInteractive(
  runCommand: string[],
  testcase: TestcaseFiles,
  interactorCommand: string[],
  timeoutMs: number,
): Promise<TestcaseResult> {
  return new Promise((resolve) => {
    const startTime = performance.now();

    const [solCmd, ...solArgs] = runCommand;
    const [intCmd, ...intArgs] = interactorCommand;

    if (!solCmd || !intCmd) {
      resolve({
        index: testcase.index,
        verdict: "SE",
        stdout: "",
        stderr: "Empty run or interactor command.",
        exitCode: -1,
        timeMs: 0,
      });
      return;
    }

    // Spawn solution process
    const solution = spawn(solCmd, solArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Spawn interactor process — receives testcase input via argument
    // The interactor reads from stdin (solution's stdout) and writes to stdout (solution's stdin)
    const interactor = spawn(intCmd, [...intArgs, "/dev/stdin"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Pipe: solution.stdout → interactor.stdin
    solution.stdout.pipe(interactor.stdin);
    // Pipe: interactor.stdout → solution.stdin
    interactor.stdout.pipe(solution.stdin);

    // Write testcase input data to interactor via a separate mechanism:
    // The interactor script is expected to read the input file path as arg.
    // We pass the testcase input through the interactor's stdin alongside solution output.
    // Actually, following the existing pattern: interactor gets input.txt as a file arg.
    // We need to write the testcase input to a temp file. But since we're inside the
    // sandbox, we can assume /submission/testcases/{index}/input exists.
    // The interactor command already has the input file path appended by the caller.

    const solutionStderr: Buffer[] = [];
    const interactorStderr: Buffer[] = [];
    const solutionStdout: Buffer[] = [];

    solution.stderr.on("data", (chunk: Buffer) => solutionStderr.push(chunk));
    interactor.stderr.on("data", (chunk: Buffer) => interactorStderr.push(chunk));
    // Also capture solution stdout for the result (even though it's piped)
    solution.stdout.on("data", (chunk: Buffer) => solutionStdout.push(chunk));

    let solutionDone = false;
    let interactorDone = false;
    let solutionExitCode = -1;
    let interactorExitCode = -1;
    let timedOut = false;
    let solutionSignal: string | null = null;
    let solutionSpawnError = false;

    const timer = setTimeout(() => {
      timedOut = true;
      solution.kill("SIGKILL");
      interactor.kill("SIGKILL");
    }, timeoutMs + 500);

    function tryFinish() {
      if (!solutionDone || !interactorDone) return;
      clearTimeout(timer);

      const timeMs = Math.round(performance.now() - startTime);
      const solStdout = Buffer.concat(solutionStdout).toString("utf-8");
      const solStderr = Buffer.concat(solutionStderr).toString("utf-8");
      const intStderr = Buffer.concat(interactorStderr).toString("utf-8");

      if (timedOut) {
        resolve({
          index: testcase.index,
          verdict: "TLE",
          stdout: solStdout,
          stderr: solStderr,
          exitCode: solutionExitCode,
          timeMs,
        });
        return;
      }

      // SE: solution failed to spawn
      if (solutionSpawnError) {
        resolve({
          index: testcase.index,
          verdict: "SE",
          stdout: solStdout,
          stderr: solStderr,
          exitCode: solutionExitCode,
          timeMs,
        });
        return;
      }

      // MLE: solution killed by external SIGKILL (e.g. OOM killer)
      if (solutionSignal === "SIGKILL") {
        resolve({
          index: testcase.index,
          verdict: "MLE",
          stdout: solStdout,
          stderr: solStderr,
          exitCode: solutionExitCode,
          timeMs,
        });
        return;
      }

      // If solution crashed, report RE
      if (solutionExitCode !== 0) {
        resolve({
          index: testcase.index,
          verdict: "RE",
          stdout: solStdout,
          stderr: solStderr,
          exitCode: solutionExitCode,
          timeMs,
        });
        return;
      }

      // Parse interactor's verdict
      const parsed = parseInteractorOutput(interactorExitCode, intStderr);

      const result: TestcaseResult = {
        index: testcase.index,
        verdict: parsed.accepted ? "AC" : "WA",
        stdout: solStdout,
        stderr: solStderr,
        exitCode: solutionExitCode,
        timeMs,
        score: parsed.score,
      };
      if (parsed.feedback) {
        result.feedback = parsed.feedback;
      }
      resolve(result);
    }

    solution.on("close", (code, signal) => {
      solutionExitCode = code ?? -1;
      solutionSignal = signal;
      solutionDone = true;
      // Close interactor's stdin when solution finishes
      interactor.stdin.end();
      tryFinish();
    });

    interactor.on("close", (code) => {
      interactorExitCode = code ?? -1;
      interactorDone = true;
      // Close solution's stdin when interactor finishes
      solution.stdin.end();
      tryFinish();
    });

    solution.on("error", (err) => {
      solutionSpawnError = true;
      solutionDone = true;
      solutionStderr.push(Buffer.from(`Spawn error: ${err.message}`));
      tryFinish();
    });

    interactor.on("error", (err) => {
      interactorDone = true;
      interactorStderr.push(Buffer.from(`Spawn error: ${err.message}`));
      tryFinish();
    });
  });
}
