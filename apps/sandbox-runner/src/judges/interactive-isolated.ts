import { spawn } from "node:child_process";
import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  parseValidatorFeedback,
  type InteractiveRunReport,
  type ValidatorFeedbackFiles,
  type ValidatorOutcome,
} from "@nojv/core";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createBoundedBuffer, createMemoryPoller, withProcessLimit } from "../utils.js";

// Cap the captured child stderr included in the marked report so a noisy
// program can't blow up the worker's stderr buffer through the marker line.
const REPORT_STDERR_CAP = 4_096;

/**
 * Solution side of an isolated interactive run. The compiled solution inherits
 * the container's stdin/stdout (fd 0/1) so the worker's byte proxy is the live
 * interaction pipe; only the child's stderr is captured here. After the child
 * exits we classify any run failure (TLE/MLE/RE/SE) and emit a SINGLE marked
 * JSON line on OUR stderr (container fd 2). The solution container mounts only
 * the source — no input, answer, or interactor.
 */
export function runInteractiveSolution(
  runCommand: string[],
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = runCommand;

    if (!cmd) {
      emitRunReport({ exitCode: -1, timeMs: 0, errorVerdict: "SE", stderr: "Empty run command." });
      resolve();
      return;
    }

    const [wrappedCmd, ...wrappedArgs] = withProcessLimit([cmd, ...args]);
    const child = spawn(wrappedCmd!, wrappedArgs, {
      // stdin/stdout ARE the container's fd 0/1 → the worker proxies bytes
      // straight to/from the interactor container. stderr is captured for the
      // run report.
      stdio: ["inherit", "inherit", "pipe"],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    });

    const memoryPoller = typeof child.pid === "number" ? createMemoryPoller(child.pid) : null;
    const stderrBuf = createBoundedBuffer();
    child.stderr.on("data", (chunk: Buffer) => stderrBuf.push(chunk));

    let forceKilled = false;
    const timer = setTimeout(() => {
      forceKilled = true;
      child.kill("SIGKILL");
    }, timeoutMs + 500);

    child.on("error", (err) => {
      clearTimeout(timer);
      const memoryKb = memoryPoller?.stop() ?? 0;
      emitRunReport({
        exitCode: -1,
        timeMs: Math.round(performance.now() - startTime),
        ...(memoryKb > 0 ? { memoryKb } : {}),
        errorVerdict: "SE",
        stderr: `Spawn error: ${err.message}`,
      });
      resolve();
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const elapsedMs = performance.now() - startTime;
      const memoryKb = memoryPoller?.stop() ?? 0;
      const exitCode = code ?? -1;

      let errorVerdict: InteractiveRunReport["errorVerdict"] = null;
      if (forceKilled || signal === "SIGTERM" || elapsedMs > timeoutMs) errorVerdict = "TLE";
      else if (signal === "SIGKILL") errorVerdict = "MLE";
      else if (exitCode !== 0) errorVerdict = "RE";

      emitRunReport({
        exitCode,
        timeMs: Math.round(elapsedMs),
        ...(memoryKb > 0 ? { memoryKb } : {}),
        errorVerdict,
        stderr: stderrBuf.toString().slice(0, REPORT_STDERR_CAP),
      });
      resolve();
    });
  });
}

/** Read a feedback file if present; missing → undefined. */
async function readFeedbackFile(dir: string, name: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(dir, name), "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Interactor side of an isolated interactive run. The DOMjudge interactor is
 * invoked `interactor <input> <answer> <feedbackDir>` with its stdin/stdout
 * inheriting the container's fd 0/1 — i.e. the live pipe to the solution. After
 * it exits we read its feedback files + exit code into a `ValidatorOutcome` and
 * emit a SINGLE marked JSON line on OUR stderr. The secret input/answer is
 * mounted ONLY into this container.
 */
export function runInteractiveValidator(
  interactorCommand: string[],
  files: { inputFile: string; answerFile: string; feedbackDir: string },
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const [cmd, ...args] = interactorCommand;

    if (!cmd) {
      emitValidateReport({ verdict: "SE", judgeMessage: "Empty interactor command." });
      resolve();
      return;
    }

    const fullArgs = [...args, files.inputFile, files.answerFile, files.feedbackDir];
    const [wrappedCmd, ...wrappedArgs] = withProcessLimit([cmd, ...fullArgs]);
    const child = spawn(wrappedCmd!, wrappedArgs, {
      stdio: ["inherit", "inherit", "pipe"],
    });

    const stderrBuf = createBoundedBuffer();
    child.stderr.on("data", (chunk: Buffer) => stderrBuf.push(chunk));

    let forceKilled = false;
    const timer = setTimeout(() => {
      forceKilled = true;
      child.kill("SIGKILL");
    }, timeoutMs + 500);

    child.on("error", (err) => {
      clearTimeout(timer);
      emitValidateReport({ verdict: "SE", judgeMessage: `Interactor failed to start: ${err.message}` });
      resolve();
    });

    child.on("close", async (code, signal) => {
      clearTimeout(timer);

      if (forceKilled || signal) {
        emitValidateReport({
          verdict: "SE",
          judgeMessage: `Interactor terminated (${signal ?? "timeout"}).`,
        });
        resolve();
        return;
      }

      const feedback: ValidatorFeedbackFiles = {};
      const scoreTxt = await readFeedbackFile(files.feedbackDir, "score.txt");
      if (scoreTxt !== undefined) feedback.scoreTxt = scoreTxt;
      const judgeMessage = await readFeedbackFile(files.feedbackDir, "judgemessage.txt");
      if (judgeMessage !== undefined) feedback.judgeMessage = judgeMessage;
      const teamMessage = await readFeedbackFile(files.feedbackDir, "teammessage.txt");
      if (teamMessage !== undefined) feedback.teamMessage = teamMessage;

      emitValidateReport(parseValidatorFeedback(code ?? -1, feedback));
      resolve();
    });
  });
}

/** Write the run report marker line on this process's stderr (container fd 2). */
function emitRunReport(report: InteractiveRunReport): void {
  process.stderr.write(`\n${INTERACTIVE_RUN_MARKER}${JSON.stringify(report)}\n`);
}

/** Write the validate report marker line on this process's stderr (container fd 2). */
function emitValidateReport(outcome: ValidatorOutcome): void {
  process.stderr.write(`\n${INTERACTIVE_VALIDATE_MARKER}${JSON.stringify(outcome)}\n`);
}
