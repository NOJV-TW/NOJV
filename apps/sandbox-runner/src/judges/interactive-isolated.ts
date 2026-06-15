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
import { writeSync as fsWriteSync } from "node:fs";
import * as path from "node:path";
import { createBoundedBuffer, createMemoryPoller, withProcessLimit } from "../utils.js";

const REPORT_STDERR_CAP = 4_096;

export function runInteractiveSolution(
  runCommand: string[],
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve) => {
    const startTime = performance.now();
    const [cmd, ...args] = runCommand;

    if (!cmd) {
      emitRunReport({
        exitCode: -1,
        timeMs: 0,
        errorVerdict: "SE",
        stderr: "Empty run command.",
      });
      resolve();
      return;
    }

    const [wrappedCmd, ...wrappedArgs] = withProcessLimit([cmd, ...args]);
    const child = spawn(wrappedCmd, wrappedArgs, {
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

export interface InteractiveCaseFiles {
  inputFile: string;
  answerFile: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function resolveInteractiveCaseFiles(
  submissionDir: string,
  index: number,
): Promise<InteractiveCaseFiles> {
  const dirInput = path.join(submissionDir, "cases", String(index), "input.txt");
  if (await pathExists(dirInput)) {
    return {
      inputFile: dirInput,
      answerFile: path.join(submissionDir, "cases", String(index), "answer.txt"),
    };
  }
  return {
    inputFile: path.join(submissionDir, `case-${String(index)}-input.txt`),
    answerFile: path.join(submissionDir, `case-${String(index)}-answer.txt`),
  };
}

async function readFeedbackFile(dir: string, name: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(dir, name), "utf-8");
  } catch {
    return undefined;
  }
}

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
    const child = spawn(wrappedCmd, wrappedArgs, {
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
      emitValidateReport({
        verdict: "SE",
        judgeMessage: `Interactor failed to start: ${err.message}`,
      });
      resolve();
    });

    child.on("close", (code, signal) => {
      void (async () => {
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
        const judgeMessage = await readFeedbackFile(files.feedbackDir, "judgemessage.txt");
        if (judgeMessage !== undefined) feedback.judgeMessage = judgeMessage;
        const teamMessage = await readFeedbackFile(files.feedbackDir, "teammessage.txt");
        if (teamMessage !== undefined) feedback.teamMessage = teamMessage;

        emitValidateReport(parseValidatorFeedback(code ?? -1, feedback));
        resolve();
      })();
    });
  });
}

function emitRunReport(report: InteractiveRunReport): void {
  writeSync(2, `\n${INTERACTIVE_RUN_MARKER}${JSON.stringify(report)}\n`);
}

function emitValidateReport(outcome: ValidatorOutcome): void {
  writeSync(2, `\n${INTERACTIVE_VALIDATE_MARKER}${JSON.stringify(outcome)}\n`);
}

function writeSync(fd: number, data: string): void {
  try {
    fsWriteSync(fd, data);
  } catch {
    return;
  }
}
