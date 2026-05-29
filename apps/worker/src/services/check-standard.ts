import {
  compareStandard,
  type RawCaseRun,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";

export function enforceMemoryLimit(
  results: SandboxTestcaseResult[],
  memoryLimitMb: number,
): SandboxTestcaseResult[] {
  const limitKb = memoryLimitMb * 1024;
  return results.map((r) =>
    (r.verdict === "AC" || r.verdict === "WA") &&
    r.memoryKb !== undefined &&
    r.memoryKb > limitKb
      ? { ...r, verdict: "MLE", score: 0 }
      : r,
  );
}

export function resolveStandardResults(
  rawRuns: RawCaseRun[],
  testcases: SandboxTestcase[],
): SandboxTestcaseResult[] {
  const expectedByIndex = new Map(testcases.map((tc) => [tc.index, tc.output]));

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
      return { ...base, verdict: run.errorVerdict, score: 0 };
    }

    const expected = expectedByIndex.get(run.index);
    if (expected === undefined) {
      return {
        ...base,
        verdict: "SE",
        score: 0,
        feedback: "Judge misconfiguration: missing expected output.",
      };
    }

    const accepted = compareStandard(run.stdout, expected);
    return { ...base, verdict: accepted ? "AC" : "WA", score: accepted ? 100 : 0 };
  });
}

export function mergeCheckerResults(
  rawRuns: RawCaseRun[],
  outcomes: Map<number, ValidatorOutcome>,
): SandboxTestcaseResult[] {
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
      return { ...base, verdict: run.errorVerdict, score: 0 };
    }

    const outcome = outcomes.get(run.index);
    if (outcome === undefined || outcome.verdict === "SE") {
      return {
        ...base,
        verdict: "SE",
        score: 0,
        feedback: "Validator did not report a verdict for this case.",
      };
    }

    const score = outcome.score ?? (outcome.verdict === "AC" ? 100 : 0);
    return {
      ...base,
      verdict: outcome.verdict,
      score,
      ...(outcome.teamMessage !== undefined ? { feedback: outcome.teamMessage } : {}),
      ...(outcome.judgeMessage !== undefined ? { staffFeedback: outcome.judgeMessage } : {}),
    };
  });
}

export function resolveSandboxResult(
  parsed: SandboxResult,
  testcases: SandboxTestcase[],
): SandboxResult {
  if (!parsed.rawRuns) {
    return parsed;
  }
  const { rawRuns, ...rest } = parsed;
  return { ...rest, testcaseResults: resolveStandardResults(rawRuns, testcases) };
}
