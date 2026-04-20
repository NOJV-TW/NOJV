import type {
  AdvancedResult,
  SandboxRequest,
  SandboxResult,
  SandboxTestcaseResult,
  SandboxVerdict,
} from "@nojv/core";

// Map the TA image's top-level verdict onto the narrower SandboxVerdict.
// Exhaustive Record so a new AdvancedResult verdict fails at the type
// level until it gets an explicit mapping. `compile_error` is mapped to
// "RE" because Advanced Mode surfaces compile failures via the top-level
// `compilationError` field on SandboxResult, not as a per-testcase verdict.
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
        verdict: "SE" as SandboxVerdict,
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
