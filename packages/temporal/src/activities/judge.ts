import {
  submissionResultSchema,
  type JudgeType,
  type NetworkAccessConfig,
  type PipelineConfig,
  type ProblemJudgeTestcase,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SubmissionDraft,
  type SubmissionResult,
  type SubmissionType
} from "@nojv/core";
import { prisma, type Prisma } from "@nojv/db";

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

// --- Types ---

export interface TestcaseSetGroup {
  id: string;
  isHidden: boolean;
  name: string;
  testcases: ProblemJudgeTestcase[];
  weight: number;
}

export interface SubmissionJudgeContext {
  artifactPatterns: string[];
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: JudgeType;
  memoryLimitMb: number;
  networkAccessConfig: NetworkAccessConfig | null;
  pipelineConfig: PipelineConfig | null;
  problemSlug: string;
  scoringLanguage: string | null;
  scoringScript: string | null;
  submissionType: SubmissionType;
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[];
  testcaseSets: TestcaseSetGroup[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
}

interface SubtaskResultItem {
  cases: { ordinal: number; runtimeMs: number; testcaseId: string; verdict: string }[];
  label: string;
  passed: boolean;
  testcaseSetId: string;
  weight: number;
}

export interface CompletedSubmission {
  contestParticipationId: string | null;
  id: string;
  language: string;
  problemId: string;
  problemSlug: string;
  sampleOnly: boolean;
  score: number;
  status: string;
  userId: string;
}

// --- Activities ---

export async function fetchJudgeContext(submissionId: string): Promise<SubmissionJudgeContext> {
  const submission = await prisma.submission.findUnique({
    include: {
      problem: {
        include: {
          templates: true,
          testcaseSets: {
            include: {
              testcases: { orderBy: { ordinal: "asc" } }
            },
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    where: { id: submissionId }
  });

  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  // Cast to access fields that Prisma generated types may not expose due to stale generation
  const problem = submission.problem as typeof submission.problem & {
    artifactPatterns: string[];
    networkAccessConfig: unknown;
    pipelineConfig: unknown;
    scoringLanguage: string | null;
    scoringScript: string | null;
  };

  const testcaseSets: TestcaseSetGroup[] = problem.testcaseSets.map((ts) => ({
    id: ts.id,
    isHidden: ts.isHidden,
    name: ts.name,
    testcases: ts.testcases.map((testcase) => ({
      expectedStdout: testcase.expectedStdout ?? undefined,
      id: testcase.id,
      inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
      isHidden: ts.isHidden,
      stdin: testcase.stdin,
      weight: ts.weight
    })),
    weight: ts.weight
  }));

  return {
    artifactPatterns: problem.artifactPatterns,
    checkerScript: problem.checkerScript,
    interactorScript: problem.interactorScript,
    judgeType: problem.judgeType,
    memoryLimitMb: problem.memoryLimitMb,
    networkAccessConfig: problem.networkAccessConfig as NetworkAccessConfig | null,
    pipelineConfig: problem.pipelineConfig as PipelineConfig | null,
    problemSlug: problem.slug,
    scoringLanguage: problem.scoringLanguage,
    scoringScript: problem.scoringScript,
    submissionType: problem.submissionType,
    templates: problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcaseSets,
    testcases: testcaseSets.flatMap((ts) => ts.testcases),
    timeLimitMs: problem.timeLimitMs
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: SubmissionJudgeContext
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await prisma.submission.update({
    data: { status: "running" },
    where: { id: submissionId }
  });

  const template = judgeContext.templates.find((t) => t.language === draft.language);
  const activeSets = draft.sampleOnly
    ? judgeContext.testcaseSets.filter((ts) => !ts.isHidden)
    : judgeContext.testcaseSets.filter((ts) => ts.isHidden);
  const testcases = activeSets.flatMap((ts) => ts.testcases);

  const staticAnalysisConfig = judgeContext.pipelineConfig?.stages.find(
    (s) => s.type === "static-analysis"
  )?.config;

  const scoringConfig = judgeContext.scoringScript
    ? {
        script: judgeContext.scoringScript,
        language: (judgeContext.scoringLanguage ?? "python") as "python",
        timeoutMs: 30_000
      }
    : undefined;

  const artifactPatterns = judgeContext.artifactPatterns;
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

export async function completeSubmission(
  submissionId: string,
  result: SubmissionResult
): Promise<CompletedSubmission> {
  const submission = await prisma.submission.update({
    data: {
      compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
      runtimeMs: result.runtimeMs,
      score: result.score,
      status: result.verdict,
      verdictDetail: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
      ...(result.subtaskResults
        ? { subtaskResults: JSON.parse(JSON.stringify(result.subtaskResults)) as Prisma.InputJsonValue }
        : {}),
      ...(result.pipelineResult
        ? { pipelineResult: JSON.parse(JSON.stringify(result.pipelineResult)) as Prisma.InputJsonValue }
        : {}),
      ...(result.artifactPaths ? { artifactPaths: result.artifactPaths } : {})
    },
    include: { problem: { select: { slug: true } } },
    where: { id: submissionId }
  });

  return {
    contestParticipationId: submission.contestParticipationId,
    id: submission.id,
    language: submission.language,
    problemId: submission.problemId,
    problemSlug: submission.problem.slug,
    sampleOnly: submission.sampleOnly,
    score: submission.score,
    status: submission.status,
    userId: submission.userId
  };
}

export async function fetchSubmissionIdsForRejudge(
  input: RejudgeInput
): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
  const where: Prisma.SubmissionWhereInput = {
    problemId: input.problemId,
    sampleOnly: false
  };

  if (input.contestId) {
    where.contestParticipation = { contestId: input.contestId };
  }
  if (input.assessmentId) {
    where.courseAssessmentId = input.assessmentId;
  }

  const submissions = await prisma.submission.findMany({
    select: {
      id: true,
      language: true,
      problem: { select: { slug: true } },
      sampleOnly: true,
      sourceCode: true
    },
    where
  });

  return submissions.map((s) => ({
    submissionId: s.id,
    draft: {
      language: s.language,
      problemSlug: s.problem.slug,
      sampleOnly: s.sampleOnly,
      sourceCode: s.sourceCode
    }
  }));
}

// --- Internal helpers ---

const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error"
};

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
  const subtaskResults = buildSubtaskResults(result, testcaseSets);

  const totalWeight = subtaskResults.reduce((s, st) => s + st.weight, 0);
  const passedWeight = subtaskResults.reduce((s, st) => s + (st.passed ? st.weight : 0), 0);
  let score = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;

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
