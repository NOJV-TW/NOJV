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

// The sandbox runs as a single opaque subprocess (`SandboxExecutor.execute`),
// so the activity can't see per-testcase progress. Emit a coarse liveness
// heartbeat on a fixed interval while it runs — without this the only signal
// of a stuck sandbox is the full 5m `startToCloseTimeout`.
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

// Student files may override only `editable` paths; readonly/hidden teacher files win.
//
// `studentSources` is the loaded-from-storage file list for the submission;
// it always contains at least `main.<ext>`. For full_source submissions the
// list has exactly one file. The merge is driven entirely off these sources
// (the database row no longer carries any inline source text).
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

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext,
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await submissionDomain.updateSubmissionStatus(submissionId, "running");

  // Sources are the canonical record in object storage. We re-load here
  // rather than trust the draft so both fresh dispatches and rejudges see
  // the same bytes; the draft's source fields are advisory and ignored.
  const studentSources = await submissionDomain.getSubmissionSources(submissionId);

  // Storage returned no files — this happens when a system_error row (where
  // the original put failed and the blobs were swept) gets rejudged. Bail
  // with a system_error tag rather than feeding an empty sourceCode to the
  // sandbox, which would compile/run nothing and surface as wrong_answer.
  if (studentSources.length === 0) {
    await submissionDomain.updateSubmissionStatus(submissionId, "system_error");
    // `system_error` is not a valid SubmissionResult.verdict (that schema is
    // limited to graded verdicts); fall back to `runtime_error` for the
    // result blob — the row status above is the authoritative signal.
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

  const testcasesForSandbox = hasRunCases
    ? runCases.map((tc, i) => ({
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
        : judgeContext.testcaseSets
            .flatMap((ts) => ts.testcases)
            .map((tc, i) => ({
              index: i,
              input: tc.input,
              ...(tc.output != null ? { output: tc.output } : {}),
              weight: tc.weight,
              isSample: false,
            }));

  const activeSets = useSamples || useAdvanced ? [] : judgeContext.testcaseSets;

  const sources = mergeSandboxSources(studentSources, draft.language, judgeContext);

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
      ...(Object.keys(judgeContext.runtime.env).length > 0
        ? { env: judgeContext.runtime.env }
        : {}),
    },
    ...(advancedPayload ? { advanced: advancedPayload } : {}),
  };

  // Heartbeat while the sandbox subprocess runs so Temporal can tell a slow
  // judge from a wedged one. `heartbeat()` is best-effort and non-blocking;
  // it has no effect on judging behaviour or the produced verdict.
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
