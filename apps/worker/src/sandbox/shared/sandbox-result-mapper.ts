import type {
  AdvancedResult,
  SandboxRequest,
  SandboxResult,
  SandboxTestcaseResult,
  SandboxVerdict,
} from "@nojv/core";

export const ADVANCED_VERDICT_TO_SANDBOX: Record<AdvancedResult["verdict"], SandboxVerdict> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
  runtime_error: "RE",
  compile_error: "RE",
};

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
  if (result.verdict === "compile_error") {
    return {
      testcaseResults: [],
      compilationError: result.feedback ?? "Compilation failed in the judge image.",
    };
  }

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
    overallVerdict: ADVANCED_VERDICT_TO_SANDBOX[result.verdict],
    ...(result.feedback ? { scoringFeedback: result.feedback } : {}),
  };
}
