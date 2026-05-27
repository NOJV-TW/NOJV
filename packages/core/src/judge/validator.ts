import type { SandboxVerdict } from "../sandbox";

export const VALIDATOR_EXIT_ACCEPT = 42;
export const VALIDATOR_EXIT_WRONG = 43;

export interface ValidatorFeedbackFiles {
  scoreTxt?: string;
  judgeMessage?: string;
  teamMessage?: string;
}

export interface ValidatorOutcome {
  verdict: Extract<SandboxVerdict, "AC" | "WA" | "SE">;
  score?: number;
  teamMessage?: string;
  judgeMessage?: string;
}

function trimmedOrUndefined(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseScore(scoreTxt: string | undefined): number | undefined {
  if (scoreTxt === undefined) return undefined;
  const value = parseFloat(scoreTxt);
  if (Number.isNaN(value)) return undefined;

  let scaled: number;
  if (value < 0) scaled = 0;
  else if (value <= 1) scaled = Math.round(value * 100);
  else scaled = Math.round(value);

  return Math.max(0, Math.min(100, scaled));
}

/**
 * Map a validator's exit code + feedback-dir files onto a verdict + optional score.
 * Exit 42 -> AC, 43 -> WA, anything else -> SE (validator/judge error).
 *
 * score.txt convention (NOJV): a float. Values in [0,1] are treated as a
 * fraction and multiplied by 100. Values > 1 are treated as already on a
 * 0..100 scale (tolerate both conventions). Result is clamped to [0,100] and
 * rounded to an integer. Absent/unparseable score.txt -> score omitted
 * (caller defaults to 100 on AC / 0 on WA).
 */
export function parseValidatorFeedback(
  exitCode: number,
  files: ValidatorFeedbackFiles,
): ValidatorOutcome {
  const verdict: ValidatorOutcome["verdict"] =
    exitCode === VALIDATOR_EXIT_ACCEPT ? "AC" : exitCode === VALIDATOR_EXIT_WRONG ? "WA" : "SE";

  const outcome: ValidatorOutcome = { verdict };

  const score = parseScore(files.scoreTxt);
  if (score !== undefined) outcome.score = score;

  const teamMessage = trimmedOrUndefined(files.teamMessage);
  if (teamMessage !== undefined) outcome.teamMessage = teamMessage;

  const judgeMessage = trimmedOrUndefined(files.judgeMessage);
  if (judgeMessage !== undefined) outcome.judgeMessage = judgeMessage;

  return outcome;
}
