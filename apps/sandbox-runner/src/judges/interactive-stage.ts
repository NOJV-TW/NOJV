import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  INTERACTIVE_RUN_MARKER,
  INTERACTIVE_VALIDATE_MARKER,
  parseValidatorFeedback,
  type InteractiveRunReport,
  type ValidatorFeedbackFiles,
  type ValidatorOutcome,
} from "@nojv/core";
import { createBoundedBuffer, readOptionalFile } from "../utils.js";
import {
  converse,
  InteractiveProtocolError,
  type FrameChannel,
} from "./interactive-channel.js";
import { measuredResult, spawnMeasured } from "./run-process.js";
import { solutionCpuSeconds, toRawCaseRun } from "./standard.js";

const REPORT_STDERR_CAP = 4_096;

function writeMarked(marker: string, report: unknown): void {
  try {
    writeSync(2, `\n${marker}${JSON.stringify(report)}\n`);
  } catch {
    return;
  }
}

export function emitRunReport(report: InteractiveRunReport & { index?: number }): void {
  writeMarked(INTERACTIVE_RUN_MARKER, report);
}

export function emitValidateReport(outcome: ValidatorOutcome & { index?: number }): void {
  writeMarked(INTERACTIVE_VALIDATE_MARKER, outcome);
}

export async function runSolutionStage(params: {
  runCommand: [string, ...string[]];
  cases: number[];
  timeoutMs: number;
  memoryLimitMb: number;
  env?: Record<string, string>;
  workspaceDir: string;
  channel: FrameChannel;
}): Promise<void> {
  for (const index of params.cases) {
    const scratch = await fs.mkdtemp(path.join(params.workspaceDir, `case-${String(index)}-`));
    const measured = spawnMeasured(params.runCommand, {
      timeoutMs: params.timeoutMs,
      cpuSeconds: solutionCpuSeconds(params.timeoutMs),
      memoryLimitMb: params.memoryLimitMb,
      env: { HOME: scratch, TMPDIR: scratch, ...params.env },
      cwd: scratch,
      stdin: "pipe",
    });
    const stderr = createBoundedBuffer(REPORT_STDERR_CAP);
    measured.proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    let protocolError: unknown = null;
    try {
      const { stdin, stdout } = measured.proc;
      if (!stdin || !stdout) throw new Error("Interactive solution has no stdio pipes.");
      await converse(params.channel, index, stdin, stdout, measured.finished);
    } catch (error) {
      protocolError = error;
      measured.proc.kill("SIGTERM");
    }
    const result = await measuredResult(measured, params.timeoutMs, {
      stdout: "",
      stderr: stderr.toString(),
      outputLimitExceeded: false,
    });
    await fs.rm(scratch, { recursive: true, force: true });
    emitRunReport({
      index,
      exitCode: result.exitCode,
      timeMs: result.timeMs,
      ...(result.memoryKb > 0 ? { memoryKb: result.memoryKb } : {}),
      errorVerdict: toRawCaseRun(result, index).errorVerdict ?? null,
      stderr: result.stderr.slice(0, REPORT_STDERR_CAP),
    });
    if (protocolError) return;
  }
}

async function interactorOutcome(
  exit: { code: number | null; signal: NodeJS.Signals | null; error?: Error },
  forceKilled: boolean,
  feedbackDir: string,
  stderr: string,
): Promise<ValidatorOutcome> {
  const detail = stderr.trim();
  if (exit.error)
    return { verdict: "SE", judgeMessage: `Interactor failed to start: ${exit.error.message}` };
  if (forceKilled || exit.signal) {
    return {
      verdict: "SE",
      judgeMessage: [
        `Interactor terminated (${exit.signal ?? "timeout"}).`,
        ...(detail ? [detail] : []),
      ].join(" "),
    };
  }
  const feedback: ValidatorFeedbackFiles = {};
  const judgeMessage = await readOptionalFile(path.join(feedbackDir, "judgemessage.txt"));
  if (judgeMessage !== undefined) feedback.judgeMessage = judgeMessage;
  const teamMessage = await readOptionalFile(path.join(feedbackDir, "teammessage.txt"));
  if (teamMessage !== undefined) feedback.teamMessage = teamMessage;
  const outcome = parseValidatorFeedback(exit.code ?? -1, feedback);
  if (outcome.verdict === "SE") {
    outcome.judgeMessage = [
      `Interactor exited with code ${String(exit.code ?? "unknown")}.`,
      ...(detail ? [detail] : []),
    ].join(" ");
  }
  return outcome;
}

export async function runInteractorStage(params: {
  interactorCommand: [string, ...string[]];
  cases: number[];
  timeoutMs: number;
  submissionDir: string;
  workDir: string;
  channel: FrameChannel;
}): Promise<void> {
  for (const [position, index] of params.cases.entries()) {
    const feedbackDir = await fs.mkdtemp(path.join(params.workDir, `fb-${String(index)}-`));
    const [cmd, ...args] = params.interactorCommand;
    const child = spawn(
      cmd,
      [
        ...args,
        path.join(params.submissionDir, `case-${String(index)}-input.txt`),
        path.join(params.submissionDir, `case-${String(index)}-answer.txt`),
        feedbackDir,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stderr = createBoundedBuffer();
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let forceKilled = false;
    const timer = setTimeout(() => {
      forceKilled = true;
      child.kill("SIGKILL");
    }, params.timeoutMs + 500);
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
    }>((resolve) => {
      child.once("error", (error) => resolve({ code: null, signal: null, error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
      await converse(params.channel, index, child.stdin, child.stdout, exited);
    } catch (error) {
      clearTimeout(timer);
      child.kill("SIGKILL");
      const message =
        error instanceof InteractiveProtocolError
          ? `Interactive protocol violation: ${error.message}`
          : `Interactive channel failed: ${error instanceof Error ? error.message : String(error)}`;
      for (const remaining of params.cases.slice(position))
        emitValidateReport({ index: remaining, verdict: "WA", judgeMessage: message });
      return;
    }
    clearTimeout(timer);
    emitValidateReport({
      index,
      ...(await interactorOutcome(await exited, forceKilled, feedbackDir, stderr.toString())),
    });
  }
}
