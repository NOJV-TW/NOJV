import type { SandboxResult, SubmissionResult } from "@nojv/core";

import { applyAdjustmentRules } from "./adjustments";
import type {
  SubmissionJudgeContext,
  TestcaseSetGroup,
  SubtaskStrategyMap,
} from "./judge-context";

export interface SubtaskResultItem {
  cases: { ordinal: number; runtimeMs: number; testcaseId: string; verdict: string }[];
  label: string;
  passed: boolean;
  rawScore: number;
  testcaseSetId: string;
  weight: number;
}

export const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error",
};

// `MINIMUM` collapses to `ALL_OR_NOTHING` — no partial-credit signal exists to take a minimum over today.
export function buildSubtaskResults(
  result: SandboxResult,
  testcaseSets: TestcaseSetGroup[],
  strategies: SubtaskStrategyMap,
): SubtaskResultItem[] {
  let flatIndex = 0;
  const subtaskResults: SubtaskResultItem[] = [];

  for (const ts of testcaseSets) {
    const cases: SubtaskResultItem["cases"] = [];
    for (let ordinal = 0; ordinal < ts.testcases.length; ordinal++) {
      const sandboxCase = result.testcaseResults[flatIndex++];
      cases.push({
        ordinal,
        runtimeMs: sandboxCase?.timeMs ?? 0,
        testcaseId: ts.testcases[ordinal]?.id ?? "",
        verdict: sandboxCase?.verdict ?? "SE",
      });
    }

    const total = cases.length;
    const passed = cases.filter((c) => c.verdict === "AC").length;
    const allPassed = total > 0 && passed === total;

    const strategy = strategies[ts.id] ?? "ALL_OR_NOTHING";
    let rawScore: number;
    if (total === 0) {
      rawScore = 0;
    } else if (strategy === "PROPORTIONAL") {
      rawScore = ts.weight * (passed / total);
    } else if (strategy === "MINIMUM") {
      rawScore = allPassed ? ts.weight : 0;
    } else {
      rawScore = allPassed ? ts.weight : 0;
    }

    subtaskResults.push({
      cases,
      label: ts.name,
      passed: allPassed,
      rawScore,
      testcaseSetId: ts.id,
      weight: ts.weight,
    });
  }

  return subtaskResults;
}

export function mapResult(
  result: SandboxResult,
  testcaseSets: TestcaseSetGroup[],
  judgeContext: SubmissionJudgeContext,
): SubmissionResult {
  const caseResults = result.testcaseResults.map((t) => ({
    index: t.index,
    passed: t.verdict === "AC",
    ...(t.stderr ? { stderr: t.stderr } : {}),
    stdout: t.stdout,
    timeMs: t.timeMs,
    ...(t.memoryKb !== undefined && t.memoryKb > 0 ? { memoryKb: t.memoryKb } : {}),
  }));

  const peakMemoryKb = result.testcaseResults.reduce(
    (peak, t) => (t.memoryKb && t.memoryKb > peak ? t.memoryKb : peak),
    0,
  );
  const memoryField = peakMemoryKb > 0 ? { memoryKb: peakMemoryKb } : {};

  if (result.compilationError) {
    return {
      accepted: false,
      caseResults: [],
      feedback: result.compilationError,
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error",
    };
  }

  if (result.pipelineError) {
    return {
      accepted: false,
      caseResults,
      feedback: `[Pipeline Error] ${result.pipelineError}`,
      runtimeMs: result.testcaseResults.reduce((s, t) => s + t.timeMs, 0),
      ...memoryField,
      score: 0,
      verdict: "compile_error",
    };
  }

  const runtimeMs = result.testcaseResults.reduce((s, t) => s + t.timeMs, 0);
  const subtaskResults = buildSubtaskResults(
    result,
    testcaseSets,
    judgeContext.subtaskStrategies,
  );

  const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
  const rawScoreSum = subtaskResults.reduce((s, st) => s + st.rawScore, 0);
  let score = totalWeight > 0 ? Math.round((rawScoreSum / totalWeight) * 100) : 0;

  if (result.customScore !== undefined) {
    score = result.customScore;
  }

  // Apply assignment adjustment rules to raw score. Only assignments
  // carry late-penalty / bonus rules — contests do not.
  const adjustmentRules = judgeContext.adjustment.assignmentAdjustmentRules ?? null;

  if (adjustmentRules && adjustmentRules.length > 0) {
    const adjusted = applyAdjustmentRules({
      dueAt: judgeContext.adjustment.dueAt,
      finalDay: judgeContext.adjustment.finalDay,
      rawScore: score,
      rules: adjustmentRules,
      runtimeMs,
      submittedAt: judgeContext.adjustment.submittedAt,
    });
    score = adjusted.score;
  }

  const allAc = result.testcaseResults.every((t) => t.verdict === "AC");

  if (allAc && score >= 100) {
    return {
      accepted: true,
      caseResults,
      feedback: result.scoringFeedback ?? "All testcases passed",
      runtimeMs,
      ...memoryField,
      score: result.customScore ?? score,
      subtaskResults,
      verdict: "accepted",
    };
  }

  if (allAc) {
    // All AC but score < 100 (e.g. late penalty dropped it). Still
    // counts as "accepted" in verdict semantics, score reflects penalty.
    return {
      accepted: true,
      caseResults,
      feedback:
        result.scoringFeedback ?? `All testcases passed (score adjusted to ${String(score)})`,
      runtimeMs,
      ...memoryField,
      score,
      subtaskResults,
      verdict: "accepted",
    };
  }

  for (const tc of result.testcaseResults) {
    if (tc.verdict !== "AC") {
      const verdict = verdictMap[tc.verdict] ?? "runtime_error";
      const feedback =
        result.scoringFeedback ??
        tc.feedback ??
        `Failed on testcase ${String(tc.index + 1)}: ${verdict.replace(/_/g, " ")}`;
      return {
        accepted: false,
        caseResults,
        feedback,
        runtimeMs,
        ...memoryField,
        score,
        subtaskResults,
        verdict,
      };
    }
  }

  return {
    accepted: false,
    caseResults,
    feedback: "Unknown error",
    runtimeMs,
    ...memoryField,
    score,
    subtaskResults,
    verdict: "runtime_error" as const,
  };
}
