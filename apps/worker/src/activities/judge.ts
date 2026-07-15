import {
  effectiveTimeLimitMs,
  entryFileNameFor,
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
): Promise<submissionDomain.JudgeDispatchMeta> {
  return submissionDomain.getJudgeDispatchMeta(submissionId);
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

  const merged = new Map<string, string>();
  for (const wf of langFiles) {
    merged.set(wf.path, wf.content);
  }

  const editablePaths = new Set(
    langFiles.filter((wf) => wf.visibility === "editable").map((wf) => wf.path),
  );

  for (const f of studentSources) {
    if (editablePaths.has(f.path)) {
      merged.set(f.path, f.content);
    }
  }

  const sourceFiles = Array.from(merged.entries()).map(([path, content]) => ({
    path,
    content,
  }));

  return {
    sourceCode: merged.get(mainPath) ?? mainSource,
    sourceFiles,
    entryFile: mainPath,
  };
}

function buildSandboxTestcases(
  judgeContext: submissionDomain.SubmissionJudgeContext,
  options: {
    useSamples: boolean;
    useAdvanced: boolean;
    runCases: SubmissionJudgeDraft["runCases"];
    hasRunCases: boolean;
  },
): SandboxRequest["testcases"] {
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

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionJudgeDraft,
): Promise<{
  result: SubmissionResult;
  advancedJudgeVerificationSnapshot: AdvancedJudgeVerificationSnapshot | null;
}> {
  const executorOwner = getExecutorOwner();

  const studentSources = await submissionDomain.getSubmissionSources(submissionId);

  if (studentSources.length === 0) {
    return {
      result: {
        accepted: false,
        verdict: "system_error",
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
          verdict: "system_error",
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

  heartbeat("sandbox-started");
  const heartbeatTimer = setInterval(() => {
    heartbeat("sandbox-running");
  }, JUDGE_HEARTBEAT_INTERVAL_MS);

  let result: Awaited<ReturnType<ExecutorOwner["execute"]>>;
  try {
    result = await executorOwner.execute(request, cancellationSignal());
  } finally {
    clearInterval(heartbeatTimer);
  }

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
    const mapped = submissionDomain.mapResult(result, [], judgeContext);
    mapped.score = 0;
    return {
      result: submissionResultSchema.parse(mapped),
      advancedJudgeVerificationSnapshot,
    };
  }

  return {
    result: submissionResultSchema.parse(
      submissionDomain.mapResult(result, activeSets, judgeContext),
    ),
    advancedJudgeVerificationSnapshot,
  };
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
  return completed;
}

export async function fetchSubmissionIdsForRejudge(
  input: BatchRejudgeInput,
): Promise<{ submissionId: string; draft: SubmissionJudgeDraft }[]> {
  return submissionDomain.listForRejudge({
    problemId: input.problemId,
    ...(input.contestId ? { contestId: input.contestId } : {}),
    ...(input.assessmentId ? { assignmentId: input.assessmentId } : {}),
    ...(input.examId ? { examId: input.examId } : {}),
    ...(input.userIds ? { userIds: input.userIds } : {}),
    ...(input.since ? { since: new Date(input.since) } : {}),
    ...(input.until ? { until: new Date(input.until) } : {}),
  });
}

export async function fetchSingleSubmissionForRejudge(
  submissionId: string,
): Promise<{ submissionId: string; draft: SubmissionJudgeDraft } | null> {
  return submissionDomain.findOneForRejudge(submissionId);
}

export async function snapshotSubmissionForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
  rejudgeRunId: string,
): Promise<{ logId: string; oldStatus: string } | null> {
  return submissionDomain.snapshotForRejudge(submissionId, triggeredByUserId, rejudgeRunId);
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
): Promise<boolean> {
  return submissionDomain.failSubmissionJudgeRun(submissionId, judgeRunId);
}
