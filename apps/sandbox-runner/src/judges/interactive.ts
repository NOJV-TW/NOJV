import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TestcaseFiles, TestcaseResult } from "../types.js";

/**
 * Parse interactor result following the existing submission-runner protocol:
 * - Exit code 0 → accepted
 * - Interactor stderr line 1: score (0-100)
 * - Interactor stderr line 2+: feedback
 */
function parseInteractorOutput(
  exitCode: number,
  stderr: string
): { accepted: boolean; score: number; feedback: string } {
  const accepted = exitCode === 0;
  const lines = stderr.trim().split("\n");

  const scoreText = lines[0]?.trim() ?? "";
  let score: number;
  if (scoreText.length > 0) {
    const parsed = parseInt(scoreText, 10);
    score = Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : accepted ? 100 : 0;
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
 * The testcase input is written to a temp file so the interactor can read it.
 * Uses Node.js stream piping (no FIFOs needed since both run locally).
 */
export async function judgeInteractive(
  runCommand: string[],
  testcase: TestcaseFiles,
  interactorCommand: string[],
  timeoutMs: number
): Promise<TestcaseResult> {
  // Write testcase input to a temp file for the interactor
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "interactive-"));
  const inputFile = path.join(tmpDir, "input.txt");
  await fs.writeFile(inputFile, testcase.input);

  try {
    return await runInteractive(runCommand, testcase, interactorCommand, inputFile, timeoutMs);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function runInteractive(
  runCommand: string[],
  testcase: TestcaseFiles,
  interactorCommand: string[],
  inputFile: string,
  timeoutMs: number
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
        timeMs: 0
      });
      return;
    }

    // Spawn solution process
    const solution = spawn(solCmd, solArgs, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Spawn interactor process — receives testcase input file path as argument
    const interactor = spawn(intCmd, [...intArgs, inputFile], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Pipe: solution.stdout → interactor.stdin
    solution.stdout.pipe(interactor.stdin);
    // Pipe: interactor.stdout → solution.stdin
    interactor.stdout.pipe(solution.stdin);

    // Handle EPIPE errors on piped streams (expected when one process exits)
    solution.stdin.on("error", () => {});
    interactor.stdin.on("error", () => {});

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
    let interactorSpawnError = false;
    let interactorSignal: string | null = null;

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
          timeMs
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
          timeMs
        });
        return;
      }

      // SE: interactor failed to spawn (system error, not user's fault)
      if (interactorSpawnError) {
        resolve({
          index: testcase.index,
          verdict: "SE",
          stdout: solStdout,
          stderr: `Interactor error: ${intStderr}`,
          exitCode: solutionExitCode,
          timeMs,
          feedback: "Interactor failed to start (system error)."
        });
        return;
      }

      // SE: interactor crashed with signal (system error)
      if (interactorSignal) {
        resolve({
          index: testcase.index,
          verdict: "SE",
          stdout: solStdout,
          stderr: `Interactor crashed with signal ${interactorSignal}.\n${intStderr}`,
          exitCode: solutionExitCode,
          timeMs,
          feedback: `Interactor crashed (${interactorSignal}).`
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
          timeMs
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
          timeMs
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
        score: parsed.score
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
      try {
        interactor.stdin.end();
      } catch {
        // Already closed
      }
      tryFinish();
    });

    interactor.on("close", (code, signal) => {
      interactorExitCode = code ?? -1;
      interactorSignal = signal;
      interactorDone = true;
      // Close solution's stdin when interactor finishes
      try {
        solution.stdin.end();
      } catch {
        // Already closed
      }
      tryFinish();
    });

    solution.on("error", (err) => {
      solutionSpawnError = true;
      solutionDone = true;
      solutionStderr.push(Buffer.from(`Spawn error: ${err.message}`));
      tryFinish();
    });

    interactor.on("error", (err) => {
      interactorSpawnError = true;
      interactorDone = true;
      interactorStderr.push(Buffer.from(`Spawn error: ${err.message}`));
      tryFinish();
    });
  });
}
