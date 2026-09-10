import {
  compareStandard,
  type CompareConfig,
  type RawCaseRun,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type SandboxVerdict,
  type ValidatorOutcome,
} from "@nojv/core";

export function errorVerdictFeedback(
  verdict: Extract<SandboxVerdict, "TLE" | "MLE" | "RE" | "SE">,
  stderr: string,
): string | undefined {
  switch (verdict) {
    case "RE":
      return stderr.trim() || "Runtime error.";
    case "TLE":
      return "Time limit exceeded.";
    case "MLE":
      return "Memory limit exceeded.";
    case "SE":
      return undefined;
  }
}

export function enforceMemoryLimit(
  results: SandboxTestcaseResult[],
  memoryLimitMb: number,
): SandboxTestcaseResult[] {
  const limitKb = memoryLimitMb * 1024;
  return results.map((r) =>
    (r.verdict === "AC" || r.verdict === "WA") &&
    r.memoryKb !== undefined &&
    r.memoryKb > limitKb
      ? { ...r, verdict: "MLE" }
      : r,
  );
}

export function resolveStandardResults(
  rawRuns: RawCaseRun[],
  testcases: SandboxTestcase[],
  compare?: CompareConfig,
): SandboxTestcaseResult[] {
  const testcaseByIndex = new Map(testcases.map((tc) => [tc.index, tc]));

  return rawRuns.map((run) => {
    const base = {
      index: run.index,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      timeMs: run.timeMs,
      ...(run.memoryKb !== undefined ? { memoryKb: run.memoryKb } : {}),
    };

    if (run.errorVerdict) {
      const feedback = errorVerdictFeedback(run.errorVerdict, run.stderr);
      return {
        ...base,
        verdict: run.errorVerdict,
        ...(feedback !== undefined ? { feedback } : {}),
      };
    }

    const testcase = testcaseByIndex.get(run.index);
    const expected = testcase?.output;
    if (expected === undefined && testcase?.isSample) return { ...base, verdict: "AC" };
    if (expected === undefined) {
      return {
        ...base,
        verdict: "SE",
        feedback: "Judge misconfiguration: missing expected output.",
      };
    }

    const accepted = compareStandard(run.stdout, expected, compare);
    return { ...base, verdict: accepted ? "AC" : "WA" };
  });
}

export function mergeCheckerResults(
  rawRuns: RawCaseRun[],
  outcomes: Map<number, ValidatorOutcome>,
  testcases: SandboxTestcase[],
): SandboxTestcaseResult[] {
  const testcaseByIndex = new Map(testcases.map((tc) => [tc.index, tc]));
  return rawRuns.map((run) => {
    const base = {
      index: run.index,
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      timeMs: run.timeMs,
      ...(run.memoryKb !== undefined ? { memoryKb: run.memoryKb } : {}),
    };

    if (run.errorVerdict) {
      const feedback = errorVerdictFeedback(run.errorVerdict, run.stderr);
      return {
        ...base,
        verdict: run.errorVerdict,
        ...(feedback !== undefined ? { feedback } : {}),
      };
    }

    const testcase = testcaseByIndex.get(run.index);
    if (testcase?.isSample && testcase.output === undefined) return { ...base, verdict: "AC" };

    const outcome = outcomes.get(run.index);
    if (outcome === undefined || outcome.verdict === "SE") {
      return {
        ...base,
        verdict: "SE",
        feedback: "Validator failed; this submission was not counted.",
        staffFeedback:
          outcome?.judgeMessage ?? `Validator did not report case ${String(run.index)}.`,
      };
    }

    return {
      ...base,
      verdict: outcome.verdict,
      ...(outcome.teamMessage !== undefined ? { feedback: outcome.teamMessage } : {}),
      ...(outcome.judgeMessage !== undefined ? { staffFeedback: outcome.judgeMessage } : {}),
    };
  });
}

export function resolveSandboxResult(
  parsed: SandboxResult,
  testcases: SandboxTestcase[],
  compare?: CompareConfig,
): SandboxResult {
  if (!parsed.rawRuns) {
    return parsed;
  }
  const { rawRuns, ...rest } = parsed;
  return { ...rest, testcaseResults: resolveStandardResults(rawRuns, testcases, compare) };
}
