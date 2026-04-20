import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type { TestcaseFiles, TestcaseResult } from "../types.js";
import { parseJudgeOutput } from "./run-process.js";
import { createBoundedBuffer, withProcessLimit } from "../utils.js";

/**
 * Bidirectional pipe between the solution and the interactor:
 *   solution.stdout → interactor.stdin
 *   interactor.stdout → solution.stdin
 *
 * The interactor receives the testcase input file path as its first arg,
 * so the input has to be written to disk before spawning. Both processes
 * run locally, so Node stream piping is enough — no FIFOs required.
 */
export async function judgeInteractive(
  runCommand: string[],
  testcase: TestcaseFiles,
  interactorCommand: string[],
  timeoutMs: number,
): Promise<TestcaseResult> {
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

    const [solWrap, ...solWrapArgs] = withProcessLimit([solCmd, ...solArgs]);
    const solution = spawn(solWrap!, solWrapArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const [intWrap, ...intWrapArgs] = withProcessLimit([intCmd, ...intArgs, inputFile]);
    const interactor = spawn(intWrap!, intWrapArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    solution.stdout.pipe(interactor.stdin);
    interactor.stdout.pipe(solution.stdin);

    // EPIPE is expected when one side exits before the other finishes writing.
    solution.stdin.on("error", () => {});
    interactor.stdin.on("error", () => {});

    const solutionStderr = createBoundedBuffer();
    const interactorStderr = createBoundedBuffer();
    const solutionStdout = createBoundedBuffer();

    solution.stderr.on("data", (chunk: Buffer) => {
      solutionStderr.push(chunk);
    });
    interactor.stderr.on("data", (chunk: Buffer) => {
      interactorStderr.push(chunk);
    });
    // Capture solution stdout alongside the pipe so we can include it in the result.
    solution.stdout.on("data", (chunk: Buffer) => {
      solutionStdout.push(chunk);
    });

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

      const solStdout = solutionStdout.toString();
      const solStderr = solutionStderr.toString();
      const intStderr = interactorStderr.toString();
      const base = {
        index: testcase.index,
        stdout: solStdout,
        exitCode: solutionExitCode,
        timeMs: Math.round(performance.now() - startTime),
      };

      if (timedOut) return resolve({ ...base, verdict: "TLE", stderr: solStderr });
      if (solutionSpawnError) return resolve({ ...base, verdict: "SE", stderr: solStderr });
      if (interactorSpawnError) {
        return resolve({
          ...base,
          verdict: "SE",
          stderr: `Interactor error: ${intStderr}`,
          feedback: "Interactor failed to start (system error).",
        });
      }
      if (interactorSignal) {
        return resolve({
          ...base,
          verdict: "SE",
          stderr: `Interactor crashed with signal ${interactorSignal}.\n${intStderr}`,
          feedback: `Interactor crashed (${interactorSignal}).`,
        });
      }
      if (solutionSignal === "SIGKILL")
        return resolve({ ...base, verdict: "MLE", stderr: solStderr });
      if (solutionExitCode !== 0) return resolve({ ...base, verdict: "RE", stderr: solStderr });

      // Interactor verdict protocol: stderr line 1 = score, lines 2+ = feedback.
      const intLines = intStderr.trim().split("\n");
      const parsed = parseJudgeOutput(
        interactorExitCode,
        intLines[0] ?? "",
        intLines.slice(1).join("\n"),
      );

      resolve({
        ...base,
        verdict: parsed.accepted ? "AC" : "WA",
        stderr: solStderr,
        score: parsed.score,
        ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
      });
    }

    solution.on("close", (code, signal) => {
      solutionExitCode = code ?? -1;
      solutionSignal = signal;
      solutionDone = true;
      try {
        interactor.stdin.end();
      } catch {
        // already closed
      }
      tryFinish();
    });

    interactor.on("close", (code, signal) => {
      interactorExitCode = code ?? -1;
      interactorSignal = signal;
      interactorDone = true;
      try {
        solution.stdin.end();
      } catch {
        // already closed
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
