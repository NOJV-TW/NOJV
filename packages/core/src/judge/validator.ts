import { z } from "zod";

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

const interactiveRunReportSchema = z.object({
  exitCode: z.number(),
  timeMs: z.number(),
  memoryKb: z.number().optional(),
  errorVerdict: z.enum(["TLE", "MLE", "RE", "SE"]).nullish(),
  stderr: z.string().optional(),
});

const interactiveValidatorReportSchema = z.object({
  verdict: z.enum(["AC", "WA", "SE"]),
  teamMessage: z.string().optional(),
  judgeMessage: z.string().optional(),
});

export function parseInteractiveRunReport(stderr: string): InteractiveRunReport | null {
  const parsed = interactiveRunReportSchema.safeParse(
    parseMarkedLine(stderr, INTERACTIVE_RUN_MARKER),
  );
  if (!parsed.success) return null;
  const report: InteractiveRunReport = {
    exitCode: parsed.data.exitCode,
    timeMs: parsed.data.timeMs,
  };
  if (parsed.data.memoryKb !== undefined) report.memoryKb = parsed.data.memoryKb;
  if (parsed.data.errorVerdict != null) report.errorVerdict = parsed.data.errorVerdict;
  if (parsed.data.stderr !== undefined) report.stderr = parsed.data.stderr;
  return report;
}

export function parseInteractiveValidatorReport(stderr: string): ValidatorOutcome | null {
  const parsed = interactiveValidatorReportSchema.safeParse(
    parseMarkedLine(stderr, INTERACTIVE_VALIDATE_MARKER),
  );
  if (!parsed.success) return null;
  const outcome: ValidatorOutcome = { verdict: parsed.data.verdict };
  if (parsed.data.teamMessage !== undefined) outcome.teamMessage = parsed.data.teamMessage;
  if (parsed.data.judgeMessage !== undefined) outcome.judgeMessage = parsed.data.judgeMessage;
  return outcome;
}
