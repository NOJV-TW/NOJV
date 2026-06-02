import {
  entryFileNameFor,
  submissionResultSchema,
  type Language,
  type SandboxExecutor,
  type SandboxRequest,
  type SubmissionDraft,
  type SubmissionResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/domain";
import type { SubmissionSource } from "@nojv/storage";
import { heartbeat } from "@temporalio/activity";

import type { RejudgeInput } from "@nojv/temporal";
import { enforceMemoryLimit } from "../services/check-standard";
import { judgeLatencyHistogram, recordJudgeLatency } from "./utils";

const JUDGE_HEARTBEAT_INTERVAL_MS = 15_000;

type BatchRejudgeInput = Extract<RejudgeInput, { mode: "batch" }>;

let _executor: SandboxExecutor | undefined;

export function setExecutor(executor: SandboxExecutor): void {
  _executor = executor;
}

function getExecutor(): SandboxExecutor {
  if (!_executor) throw new Error("Executor not initialized");
  return _executor;
}

export type CompletedSubmission = submissionDomain.CompletedSubmission;
export type SubmissionJudgeContext = submissionDomain.SubmissionJudgeContext;
export type TestcaseSetGroup = submissionDomain.TestcaseSetGroup;

export async function fetchJudgeContext(
  submissionId: string,
): Promise<submissionDomain.SubmissionJudgeContext> {
  return submissionDomain.getJudgeContext(submissionId);
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
    runCases: SubmissionDraft["runCases"];
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
  if (judgeContext.problemType !== "special_env" || !judgeContext.advanced) {
    return undefined;
  }
  const ctx = judgeContext.advanced;
  return {
    imageRef: ctx.imageRef,
    imageSource: ctx.imageSource,
    totalTimeMs: ctx.resourceLimits.totalTimeMs,
    memoryMb: ctx.resourceLimits.memoryMb,
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext,
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await submissionDomain.updateSubmissionStatus(submissionId, "running");

  const studentSources = await submissionDomain.getSubmissionSources(submissionId);

  if (studentSources.length === 0) {
    await submissionDomain.updateSubmissionStatus(submissionId, "system_error");
    return {
      accepted: false,
      verdict: "runtime_error",
      score: 0,
      runtimeMs: 0,
      caseResults: [],
      feedback: "Submission sources missing from storage; marked as system_error.",
    };
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
    },
    limits: {
      timeoutMs: judgeContext.runtime.timeLimitMs,
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

  let result: Awaited<ReturnType<SandboxExecutor["execute"]>>;
  try {
    result = await executor.execute(request);
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
    return submissionResultSchema.parse(mapped);
  }

  return submissionResultSchema.parse(
    submissionDomain.mapResult(result, activeSets, judgeContext),
  );
}

export async function completeSubmission(
  submissionId: string,
  result: SubmissionResult,
  mode: "standard" | "advanced",
): Promise<submissionDomain.CompletedSubmission> {
  const completed = await submissionDomain.completeJudge(submissionId, result);
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
): Promise<{ submissionId: string; draft: SubmissionDraft }[]> {
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
): Promise<{ submissionId: string; draft: SubmissionDraft } | null> {
  return submissionDomain.findOneForRejudge(submissionId);
}

export async function snapshotSubmissionForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
): Promise<{ logId: string; oldStatus: string } | null> {
  return submissionDomain.snapshotForRejudge(submissionId, triggeredByUserId);
}

export async function finalizeRejudgeLog(
  submissionId: string,
  triggeredByUserId: string | null,
  logId: string,
): Promise<void> {
  return submissionDomain.finalizeRejudgeLog(submissionId, triggeredByUserId, logId);
}
