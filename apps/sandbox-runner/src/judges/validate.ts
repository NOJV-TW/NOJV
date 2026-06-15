import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseValidatorFeedback, type ValidatorFeedbackFiles } from "@nojv/core";
import type { ValidatorCaseOutcome } from "../types.js";
import { runProcess } from "./run-process.js";

const VALIDATOR_TIMEOUT_FLOOR_MS = 30_000;

export function validatorTimeoutMs(solutionTimeoutMs: number): number {
  return Math.max(VALIDATOR_TIMEOUT_FLOOR_MS, solutionTimeoutMs);
}

export interface ValidateCaseFiles {
  inputFile: string;
  answerFile: string;
  teamOutput: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function resolveValidateCaseFiles(
  submissionDir: string,
  index: number,
): Promise<ValidateCaseFiles> {
  const dirInput = path.join(submissionDir, "cases", String(index), "input.txt");
  if (await pathExists(dirInput)) {
    const caseDir = path.join(submissionDir, "cases", String(index));
    const teamOutput = await fs
      .readFile(path.join(caseDir, "team.txt"), "utf-8")
      .catch(() => "");
    return {
      inputFile: dirInput,
      answerFile: path.join(caseDir, "answer.txt"),
      teamOutput,
    };
  }

  const inputFile = path.join(submissionDir, `case-${String(index)}-input.txt`);
  const answerFile = path.join(submissionDir, `case-${String(index)}-answer.txt`);
  const teamOutput = await fs
    .readFile(path.join(submissionDir, `case-${String(index)}-team.txt`), "utf-8")
    .catch(() => "");
  return { inputFile, answerFile, teamOutput };
}

async function readFeedbackFile(dir: string, name: string): Promise<string | undefined> {
  try {
    return await fs.readFile(path.join(dir, name), "utf-8");
  } catch {
    return undefined;
  }
}

export async function validateCase(
  validatorCommand: string[],
  files: { inputFile: string; answerFile: string; teamOutput: string },
  feedbackDir: string,
  index: number,
  timeoutMs: number,
): Promise<ValidatorCaseOutcome> {
  const run = await runProcess(
    [...validatorCommand, files.inputFile, files.answerFile, feedbackDir],
    {
      stdin: files.teamOutput,
      timeoutMs,
    },
  );

  if (run.spawnError) {
    return { index, verdict: "SE", judgeMessage: `Validator failed to start: ${run.stderr}` };
  }
  if (run.timedOut) {
    return { index, verdict: "SE", judgeMessage: "Validator timed out." };
  }
  if (run.signal) {
    return { index, verdict: "SE", judgeMessage: `Validator crashed (${run.signal}).` };
  }

  const feedback: ValidatorFeedbackFiles = {};
  const judgeMessage = await readFeedbackFile(feedbackDir, "judgemessage.txt");
  if (judgeMessage !== undefined) feedback.judgeMessage = judgeMessage;
  const teamMessage = await readFeedbackFile(feedbackDir, "teammessage.txt");
  if (teamMessage !== undefined) feedback.teamMessage = teamMessage;

  const outcome = parseValidatorFeedback(run.exitCode, feedback);
  return { index, ...outcome };
}
