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

export const INTERACTIVE_RUN_MARKER = "<<<NOJV_RUN>>>";
export const INTERACTIVE_VALIDATE_MARKER = "<<<NOJV_VALIDATE>>>";

export interface InteractiveRunReport {
  exitCode: number;
  timeMs: number;
  memoryKb?: number;
  errorVerdict?: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE"> | null;
  stderr?: string;
}

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
