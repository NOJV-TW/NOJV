import {
  submissionResultSchema,
  type PipelineConfig,
  type SubtaskResultItem,
  type SubmissionDraft,
  type SubmissionResult
} from "@nojv/core";
import type { SandboxExecutor, SandboxRequest, SandboxResult } from "@nojv/core";

import type { SubmissionJudgeContext, TestcaseSetGroup } from "./judge-db.js";

const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error"
};

export async function judgeSubmission(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: SubmissionJudgeContext,
  executor: SandboxExecutor
): Promise<SubmissionResult> {
  const template = judgeContext.templates.find((t) => t.language === draft.language);
  const activeSets = draft.sampleOnly
    ? judgeContext.testcaseSets.filter((ts) => !ts.isHidden)
    : judgeContext.testcaseSets.filter((ts) => ts.isHidden);
  const testcases = activeSets.flatMap((ts) => ts.testcases);

  // Extract static analysis config from pipeline if present
  const staticAnalysisConfig = extractStaticAnalysisConfig(judgeContext.pipelineConfig);

  // Build scoring config from problem fields
  const scoringConfig = judgeContext.scoringScript
    ? {
        script: judgeContext.scoringScript,
        language: (judgeContext.scoringLanguage ?? "python") as "python",
        timeoutMs: 30_000
      }
    : undefined;

  // Build artifact collection config from problem fields
  const artifactPatterns = judgeContext.artifactPatterns ?? [];
  const artifactConfig =
    artifactPatterns.length > 0
      ? { patterns: artifactPatterns, maxTotalSizeBytes: 10_000_000 }
      : undefined;

  const request: SandboxRequest = {
    submissionId,
    sourceCode: draft.sourceCode,
    ...(draft.sourceFiles ? { sourceFiles: draft.sourceFiles } : {}),
    ...(draft.entryFile ? { entryFile: draft.entryFile } : {}),
    language: draft.language,
    submissionType: judgeContext.submissionType,
    testcases: testcases.map((tc, i) => ({
      index: i,
      input: tc.stdin,
      ...(tc.expectedStdout != null ? { expected: tc.expectedStdout } : {}),
      weight: tc.weight,
      isSample: !tc.isHidden
    })),
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
      timeoutMs: judgeContext.timeLimitMs,
      memoryMb: judgeContext.memoryLimitMb
    },
    ...(template
      ? {
          template: {
            driverCode: template.driverCode,
            insertionMarker: template.insertionMarker
          }
        }
      : {}),
    ...(judgeContext.pipelineConfig ? { pipeline: judgeContext.pipelineConfig } : {}),
    ...(staticAnalysisConfig ? { staticAnalysis: staticAnalysisConfig } : {}),
    ...(scoringConfig ? { scoring: scoringConfig } : {}),
    ...(artifactConfig ? { artifactCollection: artifactConfig } : {}),
    ...(judgeContext.networkAccessConfig
      ? { networkAccess: judgeContext.networkAccessConfig }
      : {})
  };

  const result = await executor.execute(request);

  return submissionResultSchema.parse(mapResult(result, activeSets));
}

/**
 * Extract static analysis config from pipeline stages.
 * Searches the pipeline for a "static-analysis" stage and returns its config.
 */
function extractStaticAnalysisConfig(pipelineConfig: PipelineConfig | null) {
  return pipelineConfig?.stages.find((s) => s.type === "static-analysis")?.config;
}

function buildSubtaskResults(
  result: SandboxResult,
  testcaseSets: TestcaseSetGroup[]
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

    subtaskResults.push({
      cases,
      label: ts.name,
      passed: cases.every((c) => c.verdict === "AC"),
      testcaseSetId: ts.id,
      weight: ts.weight
    });
  }

  return subtaskResults;
}

function mapResult(result: SandboxResult, testcaseSets: TestcaseSetGroup[]): SubmissionResult {
  const caseResults = result.testcaseResults.map((t) => ({
    index: t.index,
    passed: t.verdict === "AC",
    ...(t.stderr ? { stderr: t.stderr } : {}),
    stdout: t.stdout,
    timeMs: t.timeMs
  }));

  // Build pipeline result metadata
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
      feedback: result.pipelineError,
      runtimeMs: result.testcaseResults.reduce((s, t) => s + t.timeMs, 0),
      score: 0,
      verdict: "runtime_error",
      ...(hasPipelineResult ? { pipelineResult } : {}),
      ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
    };
  }

  const runtimeMs = result.testcaseResults.reduce((s, t) => s + t.timeMs, 0);
  const subtaskResults = buildSubtaskResults(result, testcaseSets);

  // Score: weighted sum across subtasks (testcaseSets).
  // A subtask passes only if ALL its cases are AC.
  const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
  const passedWeight = subtaskResults.reduce((s, st) => s + (st.passed ? st.weight : 0), 0);
  let score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;

  // Apply custom score override if provided by scoring stage
  if (result.customScore !== undefined) {
    score = result.customScore;
  }

  if (result.testcaseResults.every((t) => t.verdict === "AC")) {
    return {
      accepted: true,
      caseResults,
      feedback: result.scoringFeedback ?? "All testcases passed",
      runtimeMs,
      score: result.customScore ?? 100,
      subtaskResults,
      verdict: "accepted",
      ...(hasPipelineResult ? { pipelineResult } : {}),
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
        ...(hasPipelineResult ? { pipelineResult } : {}),
        ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
      };
    }
  }

  // Unreachable: the `every` check above already returned for all-AC
  return {
    accepted: false,
    caseResults,
    feedback: "Unknown error",
    runtimeMs,
    score,
    subtaskResults,
    verdict: "runtime_error" as const,
    ...(hasPipelineResult ? { pipelineResult } : {}),
    ...(artifactPaths && artifactPaths.length > 0 ? { artifactPaths } : {})
  };
}
