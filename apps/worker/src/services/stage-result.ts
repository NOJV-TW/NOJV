import type { RawCaseRun, SandboxRequest, SandboxResult, ValidatorOutcome } from "@nojv/core";

import { mergeCheckerResults, resolveStandardResults } from "./check-standard";
import { scanJsonLinesFromEnd } from "./k8s-log-parse";
import { sourceExtension } from "./sandbox-plan";
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

export function buildJudgePayload(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};
  const checker = request.judgeType === "checker";
  if (checker) {
    const validatorScript = request.judgeConfig.checkerScript;
    if (!validatorScript) throw new Error("Checker judge is missing its validator script.");
    const validatorLanguage = request.judgeConfig.checkerLanguage;
    if (!validatorLanguage) throw new Error("Checker judge is missing checkerLanguage.");
    data[`validator.${sourceExtension(validatorLanguage)}`] = validatorScript;
  }
  for (const tc of request.testcases) {
    if (tc.output === undefined) continue;
    if (checker) data[`case-${String(tc.index)}-input.txt`] = tc.input;
    data[`case-${String(tc.index)}-answer.txt`] = tc.output;
  }
  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    ...(request.judgeConfig.compare ? { compare: request.judgeConfig.compare } : {}),
    ...(checker && request.judgeConfig.checkerLanguage
      ? { validate: { language: request.judgeConfig.checkerLanguage } }
      : {}),
    mode: { kind: "judge-stage" },
  });
  return data;
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
