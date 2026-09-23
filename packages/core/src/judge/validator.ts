import { z } from "zod";

import type { SandboxVerdict } from "../sandbox";
import type { ValidatorCaseOutcome } from "../schemas/sandbox-output";

export const VALIDATOR_EXIT_ACCEPT = 42;
export const VALIDATOR_EXIT_WRONG = 43;

export interface ValidatorFeedbackFiles {
  judgeMessage?: string;
  teamMessage?: string;
}

export type ValidatorOutcome = Omit<ValidatorCaseOutcome, "index">;

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
  index?: number;
  exitCode: number;
  timeMs: number;
  memoryKb?: number;
  errorVerdict?: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE"> | null;
  compilationError?: string;
  stderr?: string;
}

export function parseMarkedLines(stderr: string, marker: string): unknown[] {
  return stderr.split("\n").flatMap((line) => {
    if (!line.startsWith(marker)) return [];
    const payload = line.slice(marker.length).trim();
    if (!payload) return [];
    try {
      return [JSON.parse(payload) as unknown];
    } catch {
      return [];
    }
  });
}

const interactiveRunReportSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  exitCode: z.number(),
  timeMs: z.number(),
  memoryKb: z.number().optional(),
  errorVerdict: z.enum(["TLE", "MLE", "RE", "SE"]).nullish(),
  compilationError: z.string().min(1).optional(),
  stderr: z.string().optional(),
});

const interactiveValidatorReportSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  verdict: z.enum(["AC", "WA", "SE"]),
  teamMessage: z.string().optional(),
  judgeMessage: z.string().optional(),
});

export function parseInteractiveRunReports(stderr: string): InteractiveRunReport[] {
  return parseMarkedLines(stderr, INTERACTIVE_RUN_MARKER).flatMap((line) => {
    const parsed = interactiveRunReportSchema.safeParse(line);
    if (!parsed.success) return [];
    const report: InteractiveRunReport = {
      exitCode: parsed.data.exitCode,
      timeMs: parsed.data.timeMs,
    };
    if (parsed.data.index !== undefined) report.index = parsed.data.index;
    if (parsed.data.memoryKb !== undefined) report.memoryKb = parsed.data.memoryKb;
    if (parsed.data.errorVerdict != null) report.errorVerdict = parsed.data.errorVerdict;
    if (parsed.data.stderr !== undefined) report.stderr = parsed.data.stderr;
    if (parsed.data.compilationError !== undefined)
      report.compilationError = parsed.data.compilationError;
    return [report];
  });
}

export function parseInteractiveValidatorReports(
  stderr: string,
): (ValidatorOutcome & { index?: number })[] {
  return parseMarkedLines(stderr, INTERACTIVE_VALIDATE_MARKER).flatMap((line) => {
    const parsed = interactiveValidatorReportSchema.safeParse(line);
    if (!parsed.success) return [];
    const outcome: ValidatorOutcome & { index?: number } = { verdict: parsed.data.verdict };
    if (parsed.data.index !== undefined) outcome.index = parsed.data.index;
    if (parsed.data.teamMessage !== undefined) outcome.teamMessage = parsed.data.teamMessage;
    if (parsed.data.judgeMessage !== undefined) outcome.judgeMessage = parsed.data.judgeMessage;
    return [outcome];
  });
}
