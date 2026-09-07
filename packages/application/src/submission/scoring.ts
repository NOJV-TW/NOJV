import {
  MAX_CASE_STDERR_BYTES,
  MAX_CASE_STDOUT_BYTES,
  MAX_FEEDBACK_LEN,
  maxCaseRuntimeMs,
} from "@nojv/core";
import type { CaseResult, SandboxResult, SubmissionResult } from "@nojv/core";

import { applyAdjustmentRules } from "./adjustments";
import { IntegrityError } from "../shared/errors";
import type { SubmissionJudgeContext, TestcaseSetGroup } from "./types";

const TRUNCATION_MARKER = "…[truncated]";
const MAX_CASE_OUTPUT_TOTAL_BYTES = 256_000;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= TRUNCATION_MARKER.length) return TRUNCATION_MARKER.slice(0, max);
  return value.slice(0, Math.max(0, max - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
}

function truncateBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER);
  if (maxBytes <= markerBytes) return "";
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, mid)) + markerBytes <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return value.slice(0, low) + TRUNCATION_MARKER;
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
): SubtaskResultItem[] {
  let flatIndex = 0;
  const resultsByIndex = new Map(result.testcaseResults.map((item) => [item.index, item]));
  const subtaskResults: SubtaskResultItem[] = [];

  for (const ts of testcaseSets) {
    const cases: SubtaskResultItem["cases"] = [];
    for (const [ordinal, testcase] of ts.testcases.entries()) {
      const sandboxCase = resultsByIndex.get(flatIndex++);
      if (!sandboxCase) {
        throw new IntegrityError(`Missing judge result for testcase ${testcase.id}`);
      }
      cases.push({
        index: ordinal,
        verdict: sandboxCase.verdict,
        timeMs: sandboxCase.timeMs,
        testcaseId: testcase.id,
        ...(sandboxCase.memoryKb !== undefined && sandboxCase.memoryKb > 0
          ? { memoryKb: sandboxCase.memoryKb }
          : {}),
      });
    }

    const total = cases.length;
    const passed = cases.filter((c) => c.verdict === "AC").length;
    const allPassed = total > 0 && passed === total;

    subtaskResults.push({
      cases,
      label: ts.name,
      passed: allPassed,
      rawScore: allPassed ? ts.weight : 0,
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
  expectedCaseCount: number | undefined = testcaseSets.length > 0
    ? testcaseSets.reduce((total, set) => total + set.testcases.length, 0)
    : undefined,
): SubmissionResult {
  let remainingOutputBytes = MAX_CASE_OUTPUT_TOTAL_BYTES;
  const takeOutput = (value: string, perCaseLimitBytes: number): string => {
    const output = truncateBytes(value, Math.min(perCaseLimitBytes, remainingOutputBytes));
    remainingOutputBytes -= Buffer.byteLength(output);
    return output;
  };
  const caseResults = result.testcaseResults.map((t) => {
    const staffFeedback =
      t.staffFeedback !== undefined ? takeOutput(t.staffFeedback, MAX_FEEDBACK_LEN) : undefined;
    const stderr = t.stderr ? takeOutput(t.stderr, MAX_CASE_STDERR_BYTES) : "";
    const stdout = takeOutput(t.stdout, MAX_CASE_STDOUT_BYTES);
    return {
      index: t.index,
      verdict: t.verdict,
      ...(stderr ? { stderr } : {}),
      stdout,
      timeMs: t.timeMs,
      ...(t.memoryKb !== undefined && t.memoryKb > 0 ? { memoryKb: t.memoryKb } : {}),
      ...(staffFeedback ? { staffFeedback } : {}),
    };
  });

  const peakMemoryKb = result.testcaseResults.reduce(
    (peak, t) => (t.memoryKb && t.memoryKb > peak ? t.memoryKb : peak),
    0,
  );
  const runtimeMs = maxCaseRuntimeMs(result.testcaseResults);
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
      runtimeMs,
      ...memoryField,
      score: 0,
      verdict: "system_error",
    };
  }

  if (result.testcaseResults.some((t) => t.verdict === "SE")) {
    const systemCase = result.testcaseResults.find((t) => t.verdict === "SE");
    return {
      accepted: false,
      caseResults,
      feedback: truncate(
        result.scoringFeedback ??
          systemCase?.feedback ??
          "Judging failed due to a platform error. This submission was not counted; please resubmit.",
        MAX_FEEDBACK_LEN,
      ),
      runtimeMs,
      ...memoryField,
      score: 0,
      verdict: "system_error",
    };
  }

  if (expectedCaseCount !== undefined) {
    const indices = new Set(result.testcaseResults.map((item) => item.index));
    if (
      result.testcaseResults.length !== expectedCaseCount ||
      indices.size !== expectedCaseCount ||
      [...indices].some(
        (index) => !Number.isInteger(index) || index < 0 || index >= expectedCaseCount,
      )
    ) {
      return {
        accepted: false,
        caseResults: [],
        feedback: `Invalid judging results: expected ${String(expectedCaseCount)} distinct testcase results with indices 0 through ${String(expectedCaseCount - 1)}, received ${String(result.testcaseResults.length)} results with ${String(indices.size)} distinct indices. This submission was not counted.`,
        runtimeMs,
        ...memoryField,
        score: 0,
        verdict: "system_error",
      };
    }
  }

  if (result.testcaseResults.length === 0) {
    return {
      accepted: false,
      caseResults,
      feedback: truncate(
        result.scoringFeedback ??
          "No testcases were evaluated. This submission was not counted; please contact staff.",
        MAX_FEEDBACK_LEN,
      ),
      runtimeMs: 0,
      ...memoryField,
      score: 0,
      verdict: "system_error",
    };
  }

  const subtaskResults = buildSubtaskResults(result, testcaseSets);

  const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
  let score = subtaskResults.reduce((s, st) => s + st.rawScore, 0);

  if (result.customScore !== undefined) {
    score = result.customScore;
  }

  const adjustmentRules = judgeContext.adjustment.assignmentAdjustmentRules ?? null;

  if (adjustmentRules && adjustmentRules.length > 0) {
    const problemTotal = judgeContext.advanced
      ? judgeContext.advanced.config.maxScore
      : totalWeight > 0
        ? totalWeight
        : 100;
    const adjusted = applyAdjustmentRules({
      dueAt: judgeContext.adjustment.dueAt,
      finalDay: judgeContext.adjustment.finalDay,
      maxScore: problemTotal,
      rawScore: score,
      rules: adjustmentRules,
      runtimeMs,
      submittedAt: judgeContext.adjustment.submittedAt,
    });
    score = adjusted.score;
  }

  if (result.overallVerdict !== undefined) {
    const verdict =
      result.overallVerdict === "AC"
        ? ("accepted" as const)
        : (verdictMap[result.overallVerdict] ?? "runtime_error");
    return {
      accepted: verdict === "accepted",
      caseResults,
      feedback: truncate(
        result.scoringFeedback ??
          (verdict === "accepted" ? "Accepted" : `Verdict: ${verdict.replaceAll("_", " ")}`),
        MAX_FEEDBACK_LEN,
      ),
      runtimeMs,
      ...memoryField,
      score,
      subtaskResults,
      verdict,
    };
  }

  const allAc = result.testcaseResults.every((t) => t.verdict === "AC");

  if (allAc && score >= totalWeight) {
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

  throw new IntegrityError("Judging result contains no supported verdict.");
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

export function sanitizeStudentResult(
  result: SubmissionResult,
  options: { sampleOnly: boolean },
): SubmissionResult {
  const stripCase = (c: CaseResult): CaseResult => {
    const copy: CaseResult = { ...c };
    delete copy.staffFeedback;
    if (!options.sampleOnly) {
      delete copy.stdout;
      delete copy.stderr;
    }
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
