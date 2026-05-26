import type {
  AdvancedResult,
  SandboxRequest,
  SandboxResult,
  SandboxTestcaseResult,
  SandboxVerdict,
} from "@nojv/core";

// Map the TA image's top-level verdict onto the narrower SandboxVerdict.
// Exhaustive Record so a new AdvancedResult verdict fails at the type
// level until it gets an explicit mapping. `compile_error` never reaches
// this table — mapAdvancedResult intercepts it earlier and surfaces it via
// the top-level `compilationError` field on SandboxResult — but the entry
// is required for exhaustiveness, so it falls back to "RE".
export const ADVANCED_VERDICT_TO_SANDBOX: Record<AdvancedResult["verdict"], SandboxVerdict> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
  runtime_error: "RE",
  compile_error: "RE",
};

// Synthetic "overall" verdict emitted when the TA image failed to run
// or didn't produce result.json. One entry is enough — special_env
// problems don't have system-managed testcases any more.
export function advancedFallbackResult(
  _request: SandboxRequest,
  message: string,
): SandboxResult {
  return {
    testcaseResults: [
      {
        index: 0,
        verdict: "SE",
        stdout: "",
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        feedback: message,
      },
    ],
  };
}

export function mapAdvancedResult(
  _request: SandboxRequest,
  result: AdvancedResult,
): SandboxResult {
  // A compile failure in the TA image is surfaced via the top-level
  // `compilationError` field so mapResult() reports verdict "compile_error"
  // (score 0), matching standard-mode compile failures — not a per-case RE.
  if (result.verdict === "compile_error") {
    return {
      testcaseResults: [],
      compilationError: result.feedback ?? "Compilation failed in the judge image.",
    };
  }

  // Prefer per-case details from the image if present. Otherwise emit a
  // single synthetic result using the top-level verdict — the TA image
  // fully owns grading, so the system doesn't know the real case count.
  const perCaseResults: SandboxTestcaseResult[] =
    result.testcases && result.testcases.length > 0
      ? result.testcases.map((entry) => ({
          index: entry.index,
          verdict: entry.verdict,
          stdout: "",
          stderr: "",
          exitCode: 0,
          timeMs: entry.runtimeMs ?? 0,
          ...(entry.feedback ? { feedback: entry.feedback } : {}),
        }))
      : [
          {
            index: 0,
            verdict: ADVANCED_VERDICT_TO_SANDBOX[result.verdict],
            stdout: "",
            stderr: "",
            exitCode: 0,
            timeMs: 0,
            ...(result.feedback ? { feedback: result.feedback } : {}),
          },
        ];

  return {
    testcaseResults: perCaseResults,
    customScore: result.score,
    ...(result.feedback ? { scoringFeedback: result.feedback } : {}),
  };
}
