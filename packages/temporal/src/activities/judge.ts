import {
  submissionResultSchema,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SubmissionDraft,
  type SubmissionResult
} from "@nojv/core";
import { submissionDomain } from "@nojv/domain";

import type { RejudgeInput } from "../types";

// --- Executor injection (set by worker at startup) ---

let _executor: SandboxExecutor | undefined;

export function setExecutor(executor: SandboxExecutor): void {
  _executor = executor;
}

function getExecutor(): SandboxExecutor {
  if (!_executor) throw new Error("Executor not initialized");
  return _executor;
}

// --- Re-export types from domain ---

export type CompletedSubmission = submissionDomain.CompletedSubmission;
export type SubmissionJudgeContext = submissionDomain.SubmissionJudgeContext;
export type TestcaseSetGroup = submissionDomain.TestcaseSetGroup;

// --- Internal helpers ---

interface SubtaskResultItem {
  cases: { ordinal: number; runtimeMs: number; testcaseId: string; verdict: string }[];
  label: string;
  passed: boolean;
  rawScore: number;
  testcaseSetId: string;
  weight: number;
}

const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error"
};

/**
 * Compute per-subtask results, honoring the configured strategy for
 * each set.
 *
 * - `all_or_nothing`: subtask passes only if every case passed. Score is
 *   the full weight on pass, zero otherwise.
 * - `proportional`: subtask score = weight * (passed / total). Subtask
 *   is "passed" if all cases passed.
 * - `minimum`: subtask score = weight * min(caseScores) where each
 *   AC case counts as 1.0 and non-AC as 0.0. Equivalent to
 *   all_or_nothing for binary verdicts, but reserved for future partial
 *   checker support.
 */
function buildSubtaskResults(
  result: SandboxResult,
  testcaseSets: submissionDomain.TestcaseSetGroup[],
  strategies: submissionDomain.SubtaskStrategyMap
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
        verdict: sandboxCase?.verdict ?? "SE"
      });
    }

    const total = cases.length;
    const passed = cases.filter((c) => c.verdict === "AC").length;
    const allPassed = total > 0 && passed === total;

    const strategy = strategies[ts.id] ?? "all_or_nothing";
    let rawScore: number;
    if (total === 0) {
      rawScore = 0;
    } else if (strategy === "proportional") {
      rawScore = ts.weight * (passed / total);
    } else if (strategy === "minimum") {
      rawScore = allPassed ? ts.weight : 0;
    } else {
      // all_or_nothing default
      rawScore = allPassed ? ts.weight : 0;
    }

    subtaskResults.push({
      cases,
      label: ts.name,
      passed: allPassed,
      rawScore,
      testcaseSetId: ts.id,
      weight: ts.weight
    });
  }

  return subtaskResults;
}

function mapResult(
  result: SandboxResult,
  testcaseSets: submissionDomain.TestcaseSetGroup[],
  judgeContext: submissionDomain.SubmissionJudgeContext
): SubmissionResult {
  const caseResults = result.testcaseResults.map((t) => ({
    index: t.index,
    passed: t.verdict === "AC",
    ...(t.stderr ? { stderr: t.stderr } : {}),
    stdout: t.stdout,
    timeMs: t.timeMs
  }));

  const pipelineResult: Record<string, unknown> = {};
  if (result.staticAnalysis) pipelineResult.staticAnalysis = result.staticAnalysis;
  if (result.artifacts) pipelineResult.artifacts = result.artifacts;
  if (result.customStageResults) pipelineResult.customStageResults = result.customStageResults;
  if (result.customScore !== undefined) pipelineResult.customScore = result.customScore;
  if (result.scoringFeedback) pipelineResult.scoringFeedback = result.scoringFeedback;

  const hasPipelineResult = Object.keys(pipelineResult).length > 0;
  const artifactPaths = result.artifacts?.map((a) => a.path);

  if (result.compilationError) {
    return {
      accepted: false,
      caseResults: [],
      feedback: result.compilationError,
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error",
      ...(hasPipelineResult ? { pipelineResult } : {}),
      ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
    };
  }

  if (result.pipelineError) {
    return {
      accepted: false,
      caseResults,
      feedback: `[Pipeline Error] ${result.pipelineError}`,
      runtimeMs: result.testcaseResults.reduce((s, t) => s + t.timeMs, 0),
      score: 0,
      verdict: "compile_error",
      ...(hasPipelineResult ? { pipelineResult } : {}),
      ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
    };
  }

  const runtimeMs = result.testcaseResults.reduce((s, t) => s + t.timeMs, 0);
  const subtaskResults = buildSubtaskResults(
    result,
    testcaseSets,
    judgeContext.subtaskStrategies
  );

  const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
  const rawScoreSum = subtaskResults.reduce((s, st) => s + st.rawScore, 0);
  let score = totalWeight > 0 ? Math.round((rawScoreSum / totalWeight) * 100) : 0;

  if (result.customScore !== undefined) {
    score = result.customScore;
  }

  // Apply assessment/contest adjustment rules to raw score.
  const adjustmentRules =
    judgeContext.adjustment.assessmentAdjustmentRules ??
    judgeContext.adjustment.contestAdjustmentRules ??
    null;

  if (adjustmentRules && adjustmentRules.length > 0) {
    const adjusted = submissionDomain.applyAdjustmentRules({
      dueAt: judgeContext.adjustment.dueAt,
      rawScore: score,
      rules: adjustmentRules,
      runtimeMs,
      submittedAt: judgeContext.adjustment.submittedAt
    });
    score = adjusted.score;
    if (adjusted.adjustments.length > 0) {
      pipelineResult.adjustments = adjusted.adjustments;
    }
  }

  const allAc = result.testcaseResults.every((t) => t.verdict === "AC");

  if (allAc && score >= 100) {
    return {
      accepted: true,
      caseResults,
      feedback: result.scoringFeedback ?? "All testcases passed",
      runtimeMs,
      score: result.customScore ?? score,
      subtaskResults,
      verdict: "accepted",
      ...(hasPipelineResult || adjustmentRules ? { pipelineResult } : {}),
      ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
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
      score,
      subtaskResults,
      verdict: "accepted",
      ...(Object.keys(pipelineResult).length > 0 ? { pipelineResult } : {}),
      ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
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
        score,
        subtaskResults,
        verdict,
        ...(Object.keys(pipelineResult).length > 0 ? { pipelineResult } : {}),
        ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
      };
    }
  }

  return {
    accepted: false,
    caseResults,
    feedback: "Unknown error",
    runtimeMs,
    score,
    subtaskResults,
    verdict: "runtime_error" as const,
    ...(Object.keys(pipelineResult).length > 0 ? { pipelineResult } : {}),
    ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
  };
}

// --- Activities ---

export async function fetchJudgeContext(
  submissionId: string
): Promise<submissionDomain.SubmissionJudgeContext> {
  return submissionDomain.getJudgeContext(submissionId);
}

/**
 * Merge student-submitted files with teacher workspace files into the
 * source-file payload sent to the sandbox.
 *
 * - Student's `draft.sourceCode` populates the main editable file
 *   (identified by language or by `draft.entryFile`).
 * - Student's `draft.sourceFiles` (if provided) overrides any editable
 *   workspace file whose path matches.
 * - Teacher workspace files (readonly + hidden) are always added. If a
 *   student file collides with a readonly/hidden path, the teacher file
 *   wins (students cannot override locked files).
 */
function mergeSandboxSources(
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext
): {
  sourceCode: string;
  sourceFiles?: { path: string; content: string }[];
  entryFile?: string;
} {
  const langFiles = judgeContext.workspaceFiles.filter((f) => f.language === draft.language);

  if (langFiles.length === 0) {
    // No workspace files configured — legacy path, just pass the draft through.
    return {
      sourceCode: draft.sourceCode,
      ...(draft.sourceFiles ? { sourceFiles: draft.sourceFiles } : {}),
      ...(draft.entryFile ? { entryFile: draft.entryFile } : {})
    };
  }

  const merged = new Map<string, string>();

  // Start with all workspace files (teacher-provided content).
  for (const wf of langFiles) {
    merged.set(wf.path, wf.content);
  }

  // Overlay student sourceFiles, but only for editable paths.
  const editablePaths = new Set(
    langFiles.filter((wf) => wf.visibility === "editable").map((wf) => wf.path)
  );

  if (draft.sourceFiles) {
    for (const f of draft.sourceFiles) {
      if (editablePaths.has(f.path)) {
        merged.set(f.path, f.content);
      }
      // Non-editable student files are ignored (teacher version wins).
    }
  }

  // Handle the single sourceCode field: place it at draft.entryFile if
  // provided, otherwise at the first editable file's path.
  const fallbackEditable = langFiles.find((f) => f.visibility === "editable");
  const mainPath = draft.entryFile ?? fallbackEditable?.path ?? null;
  if (mainPath && draft.sourceCode && editablePaths.has(mainPath)) {
    merged.set(mainPath, draft.sourceCode);
  }

  const sourceFiles = Array.from(merged.entries()).map(([path, content]) => ({
    path,
    content
  }));

  return {
    sourceCode: mainPath ? (merged.get(mainPath) ?? draft.sourceCode) : draft.sourceCode,
    sourceFiles,
    ...(mainPath ? { entryFile: mainPath } : {})
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await submissionDomain.updateSubmissionStatus(submissionId, "running");

  const template = judgeContext.templates.find((t) => t.language === draft.language);

  // Sample path: ignore testcase sets, use Problem.samples directly.
  // Graded path: iterate testcase sets (Phase 2: all isHidden=true after
  // the data migration runs; getJudgeContext already filters them).
  const useSamples = draft.sampleOnly;
  const testcasesForSandbox = useSamples
    ? judgeContext.samples.map((s, i) => ({
        index: i,
        input: s.stdin,
        expected: s.expected,
        weight: 0,
        isSample: true
      }))
    : judgeContext.testcaseSets.flatMap((ts) =>
        ts.testcases.map((tc, i) => ({
          index: i,
          input: tc.stdin,
          ...(tc.expectedStdout != null ? { expected: tc.expectedStdout } : {}),
          weight: tc.weight,
          isSample: false
        }))
      );

  const activeSets = useSamples ? [] : judgeContext.testcaseSets;

  const sources = mergeSandboxSources(draft, judgeContext);

  const request: SandboxRequest = {
    submissionId,
    sourceCode: sources.sourceCode,
    ...(sources.sourceFiles ? { sourceFiles: sources.sourceFiles } : {}),
    ...(sources.entryFile ? { entryFile: sources.entryFile } : {}),
    language: draft.language,
    submissionType: judgeContext.submissionType,
    testcases: testcasesForSandbox,
    judgeType: judgeContext.judgeType,
    judgeConfig: {
      ...(judgeContext.checkerScript != null
        ? { checkerScript: judgeContext.checkerScript }
        : {}),
      ...(judgeContext.interactorScript != null
        ? { interactorScript: judgeContext.interactorScript }
        : {})
    },
    limits: {
      timeoutMs: judgeContext.runtime.timeLimitMs,
      memoryMb: judgeContext.runtime.memoryLimitMb
    },
    ...(template
      ? {
          template: {
            driverCode: template.driverCode,
            insertionMarker: template.insertionMarker
          }
        }
      : {})
  };

  const result = await executor.execute(request);

  // Sample runs don't apply scoring/adjustments — they're for student
  // feedback only and never go to final grades.
  if (useSamples) {
    const mapped = mapResult(result, [], judgeContext);
    mapped.score = 0;
    return submissionResultSchema.parse(mapped);
  }

  return submissionResultSchema.parse(mapResult(result, activeSets, judgeContext));
}

export async function completeSubmission(
  submissionId: string,
  result: SubmissionResult
): Promise<submissionDomain.CompletedSubmission> {
  return submissionDomain.completeJudge(submissionId, result);
}

export async function fetchSubmissionIdsForRejudge(
  input: RejudgeInput
): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  return submissionDomain.findForRejudge(input);
}
