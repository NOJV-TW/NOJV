import {
  effectiveTimeLimitMs,
  languageSchema,
  entryFileNameFor,
  mergeWorkspaceSources,
  submissionResultSchema,
  validateRequiredPaths,
  type AdvancedJudgeVerificationSnapshot,
  type Language,
  type RejudgeInput,
  type SandboxRequest,
  type SubmissionJudgeDraft,
  type SubmissionResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import type { SubmissionSource } from "@nojv/storage";
import { cancellationSignal, heartbeat } from "@temporalio/activity";

import { recordJudgePhase } from "../services/judge-phase-metrics";
import { enforceMemoryLimit } from "../services/check-standard";
import type { ExecutorOwner } from "../services/executor-owner";
import { judgeLatencyHistogram, recordJudgeLatency } from "./utils";

const JUDGE_HEARTBEAT_INTERVAL_MS = 15_000;

type BatchRejudgeInput = Extract<RejudgeInput, { mode: "batch" }>;

let _executorOwner: ExecutorOwner | undefined;

export function setExecutorOwner(executorOwner: ExecutorOwner): void {
  _executorOwner = executorOwner;
}

function getExecutorOwner(): ExecutorOwner {
  if (!_executorOwner) throw new Error("Executor owner not initialized");
  return _executorOwner;
}

export type CompletedSubmission = submissionDomain.CompletedSubmission;
export type SubmissionJudgeContext = submissionDomain.SubmissionJudgeContext;
export type TestcaseSetGroup = submissionDomain.TestcaseSetGroup;

export async function fetchJudgeContext(
  submissionId: string,
): Promise<submissionDomain.JudgeDispatchMeta & { staged: boolean }> {
  return {
    ...(await submissionDomain.getJudgeDispatchMeta(submissionId)),
    staged:
      process.env.EXECUTION_BACKEND === "kubernetes" &&
      process.env.K8S_CAPACITY_ADMISSION === "true",
  };
}

export function mergeSandboxSources(
  studentSources: readonly SubmissionSource[],
  language: Language,
  judgeContext: submissionDomain.SubmissionJudgeContext,
): {
  sourceCode: string;
  sourceFiles?: { path: string; content: string }[];
  entryFile?: string;
} {
  const mainPath = entryFileNameFor(language);
  const mainSource =
    studentSources.find((s) => s.path === mainPath)?.content ??
    studentSources[0]?.content ??
    "";

  if (judgeContext.problemType === "special_env") {
    return {
      sourceCode: "",
      sourceFiles: studentSources.map((s) => ({ path: s.path, content: s.content })),
    };
  }

  const langFiles = judgeContext.workspaceFiles.filter((f) => f.language === language);

  if (langFiles.length === 0) {
    if (studentSources.length <= 1) {
      return { sourceCode: mainSource };
    }
    return {
      sourceCode: mainSource,
      sourceFiles: studentSources.map((s) => ({ path: s.path, content: s.content })),
    };
  }

  const sourceFiles = mergeWorkspaceSources(studentSources, langFiles);

  return {
    sourceCode: sourceFiles.find((file) => file.path === mainPath)?.content ?? mainSource,
    sourceFiles,
    entryFile: mainPath,
  };
}

export function buildSandboxTestcases(
  judgeContext: submissionDomain.SubmissionJudgeContext,
  options: {
    useSamples: boolean;
    useAdvanced: boolean;
    runCases: SubmissionJudgeDraft["runCases"];
    hasRunCases: boolean;
  },
): SandboxRequest["testcases"] {
  if (options.useSamples && judgeContext.judgeType === "interactive") {
    return (judgeContext.testcaseSets[0]?.testcases ?? []).map((tc, i) => ({
      index: i,
      input: tc.input,
      ...(tc.output !== undefined ? { output: tc.output } : {}),
      weight: 0,
      isSample: true,
    }));
  }

  if (options.hasRunCases) {
    return (options.runCases ?? []).map((tc, i) => ({
      index: i,
      input: tc.input,
      ...(tc.expectedOutput !== undefined ? { output: tc.expectedOutput } : {}),
      weight: 0,
      isSample: true,
    }));
  }

  if (options.useSamples) {
    return judgeContext.samples.map((s, i) => ({
      index: i,
      input: s.input,
      output: s.output,
      weight: 0,
      isSample: true,
    }));
  }

  if (options.useAdvanced) {
    return [];
  }

  return judgeContext.testcaseSets
    .flatMap((ts) => ts.testcases)
    .map((tc, i) => ({
      index: i,
      input: tc.input,
      ...(tc.output != null ? { output: tc.output } : {}),
      weight: tc.weight,
      isSample: false,
    }));
}

function buildAdvancedPayload(
  judgeContext: submissionDomain.SubmissionJudgeContext,
): SandboxRequest["advanced"] | undefined {
  if (submissionDomain.deriveJudgeMode(judgeContext) !== "advanced" || !judgeContext.advanced) {
    return undefined;
  }
  const ctx = judgeContext.advanced;
  return {
    run: ctx.config.run,
    grade: ctx.config.grade,
    network: ctx.config.network,
    totalTimeMs: ctx.resourceLimits.totalTimeMs,
    memoryMb: ctx.resourceLimits.memoryMb,
    maxScore: ctx.config.maxScore,
  };
}

export async function loadSandboxExecution(submissionId: string, draft: SubmissionJudgeDraft) {
  const studentSources = await submissionDomain.getSubmissionSources(submissionId);

  if (studentSources.length === 0) {
    return {
      result: {
        accepted: false,
        verdict: "system_error" as const,
        score: 0,
        runtimeMs: 0,
        caseResults: [],
        feedback: "Submission sources missing from storage; marked as system_error.",
      },
      advancedJudgeVerificationSnapshot: null,
    };
  }

  const judgeContext = await submissionDomain.getJudgeContext(submissionId);
  const advancedJudgeVerificationSnapshot = judgeContext.advanced
    ? {
        config: judgeContext.advanced.config,
        requiredPaths: judgeContext.advanced.requiredPaths,
        resourceLimits: judgeContext.advanced.resourceLimits,
      }
    : null;

  if (judgeContext.advanced && judgeContext.advanced.requiredPaths.length > 0) {
    const requiredPaths = validateRequiredPaths(
      studentSources.map((source) => source.path),
      judgeContext.advanced.requiredPaths,
    );
    if (!requiredPaths.ok) {
      return {
        result: {
          accepted: false,
          verdict: "system_error" as const,
          score: 0,
          runtimeMs: 0,
          caseResults: [],
          feedback: `Submission no longer satisfies the Advanced required paths: ${requiredPaths.errors
            .map((issue) => issue.path)
            .join(", ")}`,
        },
        advancedJudgeVerificationSnapshot,
      };
    }
  }

  const useSamples = draft.sampleOnly === true;
  const useAdvanced = submissionDomain.deriveJudgeMode(judgeContext) === "advanced";
  const runCases = useSamples && !useAdvanced ? draft.runCases : undefined;
  const hasRunCases = runCases !== undefined && runCases.length > 0;

  const testcasesForSandbox = buildSandboxTestcases(judgeContext, {
    useSamples,
    useAdvanced,
    runCases,
    hasRunCases,
  });

  const activeSets = useSamples || useAdvanced ? [] : judgeContext.testcaseSets;

  const sources = mergeSandboxSources(studentSources, draft.language, judgeContext);

  const advancedPayload = buildAdvancedPayload(judgeContext);
  const request: SandboxRequest = {
    submissionId,
    sourceCode: sources.sourceCode,
    ...(sources.sourceFiles ? { sourceFiles: sources.sourceFiles } : {}),
    ...(sources.entryFile ? { entryFile: sources.entryFile } : {}),
    language: draft.language,
    problemType: judgeContext.problemType,
    testcases: testcasesForSandbox,
    judgeType: judgeContext.judgeType,
    judgeConfig: {
      ...(judgeContext.checkerLanguage != null
        ? { checkerLanguage: judgeContext.checkerLanguage }
        : {}),
      ...(judgeContext.interactorLanguage != null
        ? { interactorLanguage: judgeContext.interactorLanguage }
        : {}),
      ...(judgeContext.checkerScript != null
        ? { checkerScript: judgeContext.checkerScript }
        : {}),
      ...(judgeContext.interactorScript != null
        ? { interactorScript: judgeContext.interactorScript }
        : {}),
      ...(judgeContext.compareOptions != null ? { compare: judgeContext.compareOptions } : {}),
    },
    limits: {
      timeoutMs: effectiveTimeLimitMs(judgeContext.runtime.timeLimitMs, draft.language),
      memoryMb: judgeContext.runtime.memoryLimitMb,
      ...(Object.keys(judgeContext.runtime.env).length > 0
        ? { env: judgeContext.runtime.env }
        : {}),
    },
    ...(advancedPayload ? { advanced: advancedPayload } : {}),
  };

  return {
    request,
    judgeContext,
    advancedJudgeVerificationSnapshot,
    useSamples,
    useAdvanced,
    activeSets,
    testcasesForSandbox,
  };
}

export type SandboxExecutionData = Awaited<ReturnType<typeof loadSandboxExecution>>;

export function mapSandboxExecution(
  data: SandboxExecutionData,
  result: Awaited<ReturnType<ExecutorOwner["execute"]>>,
) {
  if (data.result !== undefined)
    return {
      result: data.result,
      advancedJudgeVerificationSnapshot: data.advancedJudgeVerificationSnapshot,
    };
  const {
    judgeContext,
    advancedJudgeVerificationSnapshot,
    useSamples,
    useAdvanced,
    activeSets,
    testcasesForSandbox,
  } = data;
  if (!useAdvanced && result.testcaseResults.length > 0) {
    result = {
      ...result,
      testcaseResults: enforceMemoryLimit(
        result.testcaseResults,
        judgeContext.runtime.memoryLimitMb,
      ),
    };
  }

  if (useSamples) {
    const mapped = submissionDomain.mapResult(
      result,
      [],
      judgeContext,
      useAdvanced ? undefined : testcasesForSandbox.length,
    );
    mapped.score = 0;
    return {
      result: submissionResultSchema.parse(mapped),
      advancedJudgeVerificationSnapshot,
    };
  }

  return {
    result: submissionResultSchema.parse(
      submissionDomain.mapResult(
        result,
        activeSets,
        judgeContext,
        useAdvanced ? undefined : testcasesForSandbox.length,
      ),
    ),
    advancedJudgeVerificationSnapshot,
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionJudgeDraft,
  runId?: string,
) {
  const data = await loadSandboxExecution(submissionId, draft);
  if (data.result !== undefined)
    return {
      result: data.result,
      advancedJudgeVerificationSnapshot: data.advancedJudgeVerificationSnapshot,
    };
  heartbeat("sandbox-started");
  const heartbeatTimer = setInterval(
    () => heartbeat("sandbox-running"),
    JUDGE_HEARTBEAT_INTERVAL_MS,
  );
  try {
    return mapSandboxExecution(
      data,
      await getExecutorOwner().execute(data.request, cancellationSignal(), runId),
    );
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function completeSubmission(
  submissionId: string,
  judgeRunId: string,
  result: SubmissionResult,
  mode: "standard" | "advanced",
  advancedConfig: AdvancedJudgeVerificationSnapshot | null = null,
): Promise<submissionDomain.CompletedSubmission | null> {
  const completed = await submissionDomain.completeJudge(
    submissionId,
    judgeRunId,
    result,
    advancedConfig,
  );
  if (!completed) return null;
  recordJudgeLatency(judgeLatencyHistogram, {
    startedAtMs: completed.createdAt.getTime(),
    completedAtMs: Date.now(),
    mode,
    verdict: completed.status,
  });
  const language = languageSchema.safeParse(completed.language);
  if (language.success)
    recordJudgePhase(
      "end_to_end",
      Date.now() - completed.createdAt.getTime(),
      mode,
      language.data,
    );
  return completed;
}

export async function fetchSubmissionIdsForRejudge(input: BatchRejudgeInput): Promise<
  {
    submissionId: string;
    studentId: string;
    staged: boolean;
    judgeGeneration: number;
    draft: SubmissionJudgeDraft;
  }[]
> {
  const targets = await submissionDomain.listForRejudge({
    problemId: input.problemId,
    ...(input.contestId ? { contestId: input.contestId } : {}),
    ...(input.assessmentId ? { assignmentId: input.assessmentId } : {}),
    ...(input.examId ? { examId: input.examId } : {}),
    ...(input.userIds ? { userIds: input.userIds } : {}),
    ...(input.since ? { since: new Date(input.since) } : {}),
    ...(input.until ? { until: new Date(input.until) } : {}),
  });
  return targets.map((target) => ({
    ...target,
    staged:
      process.env.EXECUTION_BACKEND === "kubernetes" &&
      process.env.K8S_CAPACITY_ADMISSION === "true",
  }));
}

export async function fetchSingleSubmissionForRejudge(submissionId: string): Promise<{
  submissionId: string;
  studentId: string;
  staged: boolean;
  draft: SubmissionJudgeDraft;
} | null> {
  const target = await submissionDomain.findOneForRejudge(submissionId);
  return target
    ? {
        ...target,
        staged:
          process.env.EXECUTION_BACKEND === "kubernetes" &&
          process.env.K8S_CAPACITY_ADMISSION === "true",
      }
    : null;
}

export async function snapshotSubmissionForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
  rejudgeRunId: string,
  expectedJudgeGeneration: number | null,
): Promise<{ logId: string; oldStatus: string } | null> {
  return submissionDomain.snapshotForRejudge(
    submissionId,
    triggeredByUserId,
    rejudgeRunId,
    expectedJudgeGeneration,
  );
}

export async function finalizeRejudgeLog(
  submissionId: string,
  triggeredByUserId: string | null,
  logId: string,
  judgeRunId: string,
): Promise<void> {
  return submissionDomain.finalizeRejudgeLog(
    submissionId,
    triggeredByUserId,
    logId,
    judgeRunId,
  );
}

export async function restoreSubmissionForCancelledRejudge(
  submissionId: string,
  judgeRunId: string,
  oldStatus: string,
): Promise<void> {
  return submissionDomain.restoreSubmissionAfterCancelledRejudge(
    submissionId,
    judgeRunId,
    oldStatus,
  );
}

export async function startSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
): Promise<void> {
  await submissionDomain.startSubmissionJudgeRun(submissionId, judgeRunId);
}

export async function failSubmissionJudgeRun(
  submissionId: string,
  judgeRunId: string,
  reason: string,
): Promise<boolean> {
  return submissionDomain.failSubmissionJudgeRun(submissionId, judgeRunId, reason);
}

export async function cleanupSandboxRun(runId: string): Promise<void> {
  await getExecutorOwner().cleanupRun(runId);
}
