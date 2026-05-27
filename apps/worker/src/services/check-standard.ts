import {
  compareStandard,
  type RawCaseRun,
  type SandboxResult,
  type SandboxTestcase,
  type SandboxTestcaseResult,
} from "@nojv/core";

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
