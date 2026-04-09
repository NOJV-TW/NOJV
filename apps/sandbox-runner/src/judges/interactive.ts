import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { parseJudgeOutput } from "./run-process.js";

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

      const solStdout = Buffer.concat(solutionStdout).toString("utf-8");
      const solStderr = Buffer.concat(solutionStderr).toString("utf-8");
      const intStderr = Buffer.concat(interactorStderr).toString("utf-8");
      const base = {
        index: testcase.index,
        stdout: solStdout,
        exitCode: solutionExitCode,
        timeMs: Math.round(performance.now() - startTime)
      };

      if (timedOut) return resolve({ ...base, verdict: "TLE", stderr: solStderr });
      if (solutionSpawnError) return resolve({ ...base, verdict: "SE", stderr: solStderr });
      if (interactorSpawnError) {
        return resolve({
          ...base,
          verdict: "SE",
          stderr: `Interactor error: ${intStderr}`,
          feedback: "Interactor failed to start (system error)."
        });
      }
      if (interactorSignal) {
        return resolve({
          ...base,
          verdict: "SE",
          stderr: `Interactor crashed with signal ${interactorSignal}.\n${intStderr}`,
          feedback: `Interactor crashed (${interactorSignal}).`
        });
      }
      if (solutionSignal === "SIGKILL") return resolve({ ...base, verdict: "MLE", stderr: solStderr });
      if (solutionExitCode !== 0) return resolve({ ...base, verdict: "RE", stderr: solStderr });

      // Parse interactor's verdict — stderr line 1 = score, lines 2+ = feedback
      const intLines = intStderr.trim().split("\n");
      const parsed = parseJudgeOutput(
        interactorExitCode,
        intLines[0] ?? "",
        intLines.slice(1).join("\n")
      );

      resolve({
        ...base,
        verdict: parsed.accepted ? "AC" : "WA",
        stderr: solStderr,
        score: parsed.score,
        ...(parsed.feedback ? { feedback: parsed.feedback } : {})
      });
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
