import {
  compareStandard,
  type RawCaseRun,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
  type ValidatorOutcome,
} from "@nojv/core";

// Enforces the per-problem memoryLimitMb from the runner's peak RSS — the
// container cgroup only bounds the global SANDBOX_MEMORY_MB ceiling.
export function enforceMemoryLimit(
  results: SandboxTestcaseResult[],
  memoryLimitMb: number,
): SandboxTestcaseResult[] {
  const limitKb = memoryLimitMb * 1024;
  return results.map((r) =>
    (r.verdict === "AC" || r.verdict === "WA") && r.memoryKb !== undefined && r.memoryKb > limitKb
      ? { ...r, verdict: "MLE", score: 0 }
      : r,
  );
}

/**
 * Decide AC/WA for standard-mode runs by comparing the runner's raw output
 * against the expected answer the worker already holds. The expected answer
 * is never shipped into the sandbox, so this comparison happens here instead
 * of in the run container.
 *
 * A `rawRun.errorVerdict` (TLE/MLE/RE/SE) means the run itself failed and is
 * passed through unchanged. A run with no matching testcase, or whose
 * testcase has no expected output, is an SE — a misconfiguration the learner
 * shouldn't be silently graded against.
 */
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

/**
 * Decide each checker case by merging the run-phase raw output with the
 * isolated validator's per-case outcome. A failed run (TLE/MLE/RE/SE) passes
 * through unchanged — the validator never ran for it. A clean run takes the
 * validator's verdict/score; the validator's `teamMessage` becomes the
 * student-facing `feedback` and `judgeMessage` becomes the staff-only
 * `staffFeedback` (gated downstream so it never reaches the student). A clean
 * run with no validator outcome is an SE (the validator failed to report on
 * that case).
 */
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

/**
 * Normalize a parsed runner result into a `SandboxResult` carrying
 * `testcaseResults`. Standard mode emits `rawRuns` for worker-side checking;
 * convert those against the request testcases. Checker/interactive already
 * emit `testcaseResults`, so they pass through unchanged.
 */
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
