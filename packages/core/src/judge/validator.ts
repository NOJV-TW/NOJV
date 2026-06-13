import type { SandboxVerdict } from "../sandbox";

export const VALIDATOR_EXIT_ACCEPT = 42;
export const VALIDATOR_EXIT_WRONG = 43;

export interface ValidatorFeedbackFiles {
  judgeMessage?: string;
  teamMessage?: string;
}

export interface ValidatorOutcome {
  verdict: Extract<SandboxVerdict, "AC" | "WA" | "SE">;
  teamMessage?: string;
  judgeMessage?: string;
}

function trimmedOrUndefined(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseValidatorFeedback(
  exitCode: number,
  files: ValidatorFeedbackFiles,
): ValidatorOutcome {
  const nonAcceptVerdict: ValidatorOutcome["verdict"] =
    exitCode === VALIDATOR_EXIT_WRONG ? "WA" : "SE";
  const verdict: ValidatorOutcome["verdict"] =
    exitCode === VALIDATOR_EXIT_ACCEPT ? "AC" : nonAcceptVerdict;

  const outcome: ValidatorOutcome = { verdict };

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
