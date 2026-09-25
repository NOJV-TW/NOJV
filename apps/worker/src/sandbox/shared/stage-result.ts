import type { RawCaseRun, SandboxRequest, SandboxResult, ValidatorOutcome } from "@nojv/core";

import { mergeCheckerResults, resolveStandardResults } from "./check-standard";
import { scanJsonLinesFromEnd } from "./log-parse";
import { parseSandboxResult, parseValidateOutput } from "./sandbox-schema";

export function gradableRuns(request: SandboxRequest, rawRuns: RawCaseRun[]): RawCaseRun[] {
  const answered = new Set(
    request.testcases.filter((tc) => tc.output !== undefined).map((tc) => tc.index),
  );
  return rawRuns.filter((run) => !run.errorVerdict && answered.has(run.index));
}

export function judgeFailedForAll(
  runs: RawCaseRun[],
  judgeMessage: string,
): Map<number, ValidatorOutcome> {
  return new Map(runs.map((run) => [run.index, { verdict: "SE", judgeMessage }]));
}

export function parseJudgeOutcomes(
  output: string,
  gradable: RawCaseRun[],
): Map<number, ValidatorOutcome> {
  if (gradable.length === 0) return new Map();
  return (
    scanJsonLinesFromEnd(output, (json) => {
      if (
        typeof json !== "object" ||
        json === null ||
        !(
          "validatorOutcomes" in json ||
          "compilationError" in json ||
          "testcaseResults" in json
        )
      )
        return null;
      const parsed = parseValidateOutput(
        json,
        gradable.map(({ index }) => index),
      );
      if (!parsed.success) {
        const fatal = parseSandboxResult(json);
        const diagnostic = fatal.success
          ? (fatal.data.pipelineError ??
            fatal.data.testcaseResults.find((result) => result.verdict === "SE")?.stderr)
          : undefined;
        return judgeFailedForAll(
          gradable,
          diagnostic ?? `Invalid judge output: ${parsed.error.message}`,
        );
      }
      if (parsed.data.compilationError !== undefined)
        return judgeFailedForAll(gradable, parsed.data.compilationError);
      if (!parsed.data.validatorOutcomes)
        return judgeFailedForAll(gradable, "Judge produced no case outcomes.");
      return new Map(
        parsed.data.validatorOutcomes.map(({ index, ...outcome }) => [index, outcome]),
      );
    }) ?? judgeFailedForAll(gradable, "Judge produced no result.")
  );
}

export function mergeStageResults(
  request: SandboxRequest,
  rawRuns: RawCaseRun[],
  outcomes: Map<number, ValidatorOutcome>,
): SandboxResult {
  return {
    testcaseResults:
      request.judgeType === "checker"
        ? mergeCheckerResults(rawRuns, outcomes, request.testcases)
        : resolveStandardResults(rawRuns, request.testcases, outcomes),
  };
}

export function completeRuns(
  request: SandboxRequest,
  rawRuns: RawCaseRun[],
  message: string,
): RawCaseRun[] {
  const byIndex = new Map(rawRuns.map((run) => [run.index, run]));
  return request.testcases.map(
    (tc) =>
      byIndex.get(tc.index) ?? {
        index: tc.index,
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        errorVerdict: "SE",
      },
  );
}

export function parseCompilationError(logs: string): string | null {
  return (
    scanJsonLinesFromEnd(logs, (json) => {
      if (typeof json !== "object" || json === null) return null;
      const { compilationError, runCommand } = json as {
        compilationError?: unknown;
        runCommand?: unknown;
      };
      if (typeof compilationError === "string") return { value: compilationError };
      return Array.isArray(runCommand) && runCommand.every((arg) => typeof arg === "string")
        ? { value: null }
        : null;
    })?.value ?? null
  );
}

export function parseRunResult(logs: string): SandboxResult | null {
  return scanJsonLinesFromEnd(logs, (json) => {
    if (
      typeof json !== "object" ||
      json === null ||
      !("rawRuns" in json || "testcaseResults" in json || "pipelineError" in json)
    )
      return null;
    const parsed = parseSandboxResult(json);
    return parsed.success
      ? parsed.data
      : {
          testcaseResults: [],
          pipelineError: `Invalid sandbox output: ${parsed.error.message}`,
        };
  });
}
