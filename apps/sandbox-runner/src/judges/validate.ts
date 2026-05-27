import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseValidatorFeedback, type ValidatorFeedbackFiles } from "@nojv/core";
import type { ValidatorCaseOutcome } from "../types.js";
import { runProcess } from "./run-process.js";

// The validator post-processes one case's output. Mirror the checker floor:
// generous enough for slow-but-correct validators, scaling up with the
// solution's time limit but never below 30s.
const VALIDATOR_TIMEOUT_FLOOR_MS = 30_000;

export function validatorTimeoutMs(solutionTimeoutMs: number): number {
  return Math.max(VALIDATOR_TIMEOUT_FLOOR_MS, solutionTimeoutMs);
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
 * Run the validator over a single case. The validator is invoked
 * `validator <input> <answer> <feedbackDir>` with the team output on stdin;
 * exit 42 = AC, 43 = WA, else = SE. Validator infrastructure failures
 * (spawn error, timeout, crash signal) map to SE — not the student's fault.
 */
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
  const scoreTxt = await readFeedbackFile(feedbackDir, "score.txt");
  if (scoreTxt !== undefined) feedback.scoreTxt = scoreTxt;
  const judgeMessage = await readFeedbackFile(feedbackDir, "judgemessage.txt");
  if (judgeMessage !== undefined) feedback.judgeMessage = judgeMessage;
  const teamMessage = await readFeedbackFile(feedbackDir, "teammessage.txt");
  if (teamMessage !== undefined) feedback.teamMessage = teamMessage;

  const outcome = parseValidatorFeedback(run.exitCode, feedback);
  return { index, ...outcome };
}
