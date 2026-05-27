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

// Interactive judging splits the solution and the interactor into two isolated
// containers whose stdio is the live interaction pipe. Each container reports
// its result to the worker as a SINGLE marked line on its own stderr (fd 2),
// since stdout is consumed by the pipe. The worker scans for these markers.
export const INTERACTIVE_RUN_MARKER = "<<<NOJV_RUN>>>";
export const INTERACTIVE_VALIDATE_MARKER = "<<<NOJV_VALIDATE>>>";

/** Solution-container run result, emitted on the marked stderr line. */
export interface InteractiveRunReport {
  exitCode: number;
  timeMs: number;
  memoryKb?: number;
  // Set when the SOLUTION run itself failed; the interactor's verdict is moot.
  errorVerdict?: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE"> | null;
  stderr?: string;
}

/**
 * Extract the JSON payload following the last occurrence of `marker` on its own
 * line in `stderr`. Returns `null` when the marker is absent or its payload is
 * not valid JSON — the caller maps that to SE.
 */
export function parseMarkedLine(stderr: string, marker: string): unknown {
  const idx = stderr.lastIndexOf(marker);
  if (idx === -1) return null;
  const rest = stderr.slice(idx + marker.length);
  const newline = rest.indexOf("\n");
  const payload = (newline === -1 ? rest : rest.slice(0, newline)).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
