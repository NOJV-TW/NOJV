import {
  advancedResultSchema,
  validateAdvancedResultForMaxScore,
  type AdvancedResult,
  type SandboxResult,
  type SandboxTestcaseResult,
  type SandboxVerdict,
} from "@nojv/core";

import { sandboxSystemError } from "./sandbox-plan";

export const ADVANCED_VERDICT_TO_SANDBOX: Record<AdvancedResult["verdict"], SandboxVerdict> = {
  accepted: "AC",
  wrong_answer: "WA",
  time_limit_exceeded: "TLE",
  memory_limit_exceeded: "MLE",
  runtime_error: "RE",
  compile_error: "RE",
};

export function mapAdvancedResult(result: AdvancedResult): SandboxResult {
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

export function resolveAdvancedResult(raw: unknown, maxScore: number): SandboxResult {
  const parsed = advancedResultSchema.safeParse(raw);
  if (!parsed.success) {
    return sandboxSystemError(
      `Invalid result.json: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  const resultIssues = validateAdvancedResultForMaxScore(parsed.data, maxScore);
  if (resultIssues.length > 0) {
    return sandboxSystemError(`Invalid result.json: ${resultIssues.join(", ")}`);
  }
  return mapAdvancedResult(parsed.data);
}
