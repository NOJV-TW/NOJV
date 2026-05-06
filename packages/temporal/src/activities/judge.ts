import {
  entryFileNameFor,
  submissionResultSchema,
  type SandboxExecutor,
  type SandboxRequest,
  type SubmissionDraft,
  type SubmissionResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/domain";

import type { RejudgeInput } from "../types";
import { judgeLatencyHistogram, recordJudgeLatency } from "./metrics";

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

// Student files may override only `editable` paths; readonly/hidden teacher files win.
function mergeSandboxSources(
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext,
): {
  sourceCode: string;
  sourceFiles?: { path: string; content: string }[];
  entryFile?: string;
} {
  const langFiles = judgeContext.workspaceFiles.filter((f) => f.language === draft.language);

  if (langFiles.length === 0) {
    return {
      sourceCode: draft.sourceCode,
      ...(draft.sourceFiles ? { sourceFiles: draft.sourceFiles } : {}),
    };
  }

  const merged = new Map<string, string>();
  for (const wf of langFiles) {
    merged.set(wf.path, wf.content);
  }

  const editablePaths = new Set(
    langFiles.filter((wf) => wf.visibility === "editable").map((wf) => wf.path),
  );

  if (draft.sourceFiles) {
    for (const f of draft.sourceFiles) {
      if (editablePaths.has(f.path)) {
        merged.set(f.path, f.content);
      }
    }
  }

  // Entry file is always `main.<ext>`; `draft.entryFile` is ignored by design.
  const mainPath = entryFileNameFor(draft.language);
  if (draft.sourceCode && editablePaths.has(mainPath)) {
    merged.set(mainPath, draft.sourceCode);
  }

  const sourceFiles = Array.from(merged.entries()).map(([path, content]) => ({
    path,
    content,
  }));

  return {
    sourceCode: merged.get(mainPath) ?? draft.sourceCode,
    sourceFiles,
    entryFile: mainPath,
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext,
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await submissionDomain.updateSubmissionStatus(submissionId, "running");

  const useSamples = draft.sampleOnly === true;
  const useAdvanced =
    judgeContext.problemType === "special_env" && judgeContext.advanced !== null;
  const hasRunCases =
    useSamples && !useAdvanced && draft.runCases !== undefined && draft.runCases.length > 0;

  const testcasesForSandbox = hasRunCases
    ? draft.runCases!.map((tc, i) => ({
        index: i,
        input: tc.input,
        ...(tc.expectedOutput !== undefined ? { output: tc.expectedOutput } : {}),
        weight: 0,
        isSample: true,
      }))
    : useSamples
      ? judgeContext.samples.map((s, i) => ({
          index: i,
          input: s.input,
          output: s.output,
          weight: 0,
          isSample: true,
        }))
      : useAdvanced
        ? [] // advanced: TA image bundles testcases
        : judgeContext.testcaseSets.flatMap((ts) =>
            ts.testcases.map((tc, i) => ({
              index: i,
              input: tc.input,
              ...(tc.output != null ? { output: tc.output } : {}),
              weight: tc.weight,
              isSample: false,
            })),
          );

  const activeSets = useSamples || useAdvanced ? [] : judgeContext.testcaseSets;

  const sources = mergeSandboxSources(draft, judgeContext);

  let advancedPayload: SandboxRequest["advanced"] | undefined;
  if (judgeContext.problemType === "special_env" && judgeContext.advanced) {
    const ctx = judgeContext.advanced;
    advancedPayload = {
      imageRef: ctx.imageRef,
      imageSource: ctx.imageSource,
      totalTimeMs: ctx.resourceLimits.totalTimeMs,
      memoryMb: ctx.resourceLimits.memoryMb,
    };
  }

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
    },
    ...(advancedPayload ? { advanced: advancedPayload } : {}),
  };

  const result = await executor.execute(request);

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
  return submissionDomain.findForRejudge({
    problemId: input.problemId,
    ...(input.contestId ? { contestId: input.contestId } : {}),
    ...(input.assessmentId ? { assessmentId: input.assessmentId } : {}),
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
