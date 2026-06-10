import { MAX_CASE_STDERR_BYTES, MAX_CASE_STDOUT_BYTES, MAX_FEEDBACK_LEN } from "@nojv/core";
import type { CaseResult, SandboxResult, SubmissionResult } from "@nojv/core";
import type { SubtaskScoringStrategy } from "@nojv/db";

import { applyAdjustmentRules } from "./adjustments";
import type { SubmissionJudgeContext, TestcaseSetGroup, SubtaskStrategyMap } from "./types";

const TRUNCATION_MARKER = "…[truncated]";

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
}

export interface SubtaskResultItem {
  cases: {
    index: number;
    verdict: string;
    timeMs: number;
    testcaseId: string;
    memoryKb?: number;
  }[];
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
  SE: "system_error",
};

export function buildSubtaskResults(
  result: SandboxResult,
  testcaseSets: TestcaseSetGroup[],
  strategies: SubtaskStrategyMap,
): SubtaskResultItem[] {
  let flatIndex = 0;
  const subtaskResults: SubtaskResultItem[] = [];

  for (const ts of testcaseSets) {
    const cases: SubtaskResultItem["cases"] = [];
    const caseScores: number[] = [];
    for (let ordinal = 0; ordinal < ts.testcases.length; ordinal++) {
      const sandboxCase = result.testcaseResults[flatIndex++];
      const verdict = sandboxCase?.verdict ?? "SE";
      cases.push({
        index: ordinal,
        verdict,
        timeMs: sandboxCase?.timeMs ?? 0,
        testcaseId: ts.testcases[ordinal]?.id ?? "",
        ...(sandboxCase?.memoryKb !== undefined && sandboxCase.memoryKb > 0
          ? { memoryKb: sandboxCase.memoryKb }
          : {}),
      });
      caseScores.push(sandboxCase?.score ?? (verdict === "AC" ? 100 : 0));
    }

    const total = cases.length;
    const passed = cases.filter((c) => c.verdict === "AC").length;
    const allPassed = total > 0 && passed === total;

    const strategy = strategies[ts.id] ?? "ALL_OR_NOTHING";
    const rawScore = computeSubtaskRawScore(strategy, caseScores, ts.weight, total, allPassed);

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

function computeSubtaskRawScore(
  strategy: SubtaskScoringStrategy,
  caseScores: number[],
  weight: number,
  total: number,
  allPassed: boolean,
): number {
  if (total === 0) {
    return 0;
  }
  if (strategy === "PROPORTIONAL") {
    const sumScore = caseScores.reduce((s, v) => s + v, 0);
    return (weight * sumScore) / (total * 100);
  }
  if (strategy === "MINIMUM") {
    const minScore = Math.min(...caseScores);
    return (weight * minScore) / 100;
  }
  return allPassed ? weight : 0;
}

export function mapResult(
  result: SandboxResult,
  testcaseSets: TestcaseSetGroup[],
  judgeContext: SubmissionJudgeContext,
): SubmissionResult {
  const caseResults = result.testcaseResults.map((t) => ({
    index: t.index,
    verdict: t.verdict,
    ...(t.stderr ? { stderr: truncate(t.stderr, MAX_CASE_STDERR_BYTES) } : {}),
    stdout: truncate(t.stdout, MAX_CASE_STDOUT_BYTES),
    timeMs: t.timeMs,
    ...(t.memoryKb !== undefined && t.memoryKb > 0 ? { memoryKb: t.memoryKb } : {}),
    ...(t.staffFeedback !== undefined
      ? { staffFeedback: truncate(t.staffFeedback, MAX_FEEDBACK_LEN) }
      : {}),
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
      feedback: truncate(result.compilationError, MAX_FEEDBACK_LEN),
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error",
    };
  }

  if (result.pipelineError) {
    return {
      accepted: false,
      caseResults,
      feedback: truncate(`[Pipeline Error] ${result.pipelineError}`, MAX_FEEDBACK_LEN),
      runtimeMs: result.testcaseResults.reduce((s, t) => s + t.timeMs, 0),
      ...memoryField,
      score: 0,
      verdict: "compile_error",
    };
  }

  if (result.testcaseResults.some((t) => t.verdict === "SE")) {
    return {
      accepted: false,
      caseResults,
      feedback: truncate(
        result.scoringFeedback ??
          "Judging failed due to a platform error. This submission was not counted; please resubmit.",
        MAX_FEEDBACK_LEN,
      ),
      runtimeMs: result.testcaseResults.reduce((s, t) => s + t.timeMs, 0),
      ...memoryField,
      score: 0,
      verdict: "system_error",
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
      feedback: truncate(result.scoringFeedback ?? "All testcases passed", MAX_FEEDBACK_LEN),
      runtimeMs,
      ...memoryField,
      score: result.customScore ?? score,
      subtaskResults,
      verdict: "accepted",
    };
  }

  if (allAc) {
    return {
      accepted: true,
      caseResults,
      feedback: truncate(
        result.scoringFeedback ?? `All testcases passed (score adjusted to ${String(score)})`,
        MAX_FEEDBACK_LEN,
      ),
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
      const feedback = truncate(
        result.scoringFeedback ??
          tc.feedback ??
          `Failed on testcase ${String(tc.index + 1)}: ${verdict.replaceAll("_", " ")}`,
        MAX_FEEDBACK_LEN,
      );
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

export function stripStaffFeedback(result: SubmissionResult): SubmissionResult {
  const stripCase = (c: CaseResult): CaseResult => {
    if (c.staffFeedback === undefined) return c;
    const copy: CaseResult = { ...c };
    delete copy.staffFeedback;
    return copy;
  };
  return {
    ...result,
    ...(result.caseResults !== undefined
      ? { caseResults: result.caseResults.map(stripCase) }
      : {}),
    ...(result.subtaskResults !== undefined
      ? {
          subtaskResults: result.subtaskResults.map((s) => ({
            ...s,
            cases: s.cases.map(stripCase),
          })),
        }
      : {}),
  };
}
