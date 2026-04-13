import {
  entryFileNameFor,
  submissionResultSchema,
  type SandboxExecutor,
  type SandboxRequest,
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

// --- Activities ---

export async function fetchJudgeContext(
  submissionId: string
): Promise<submissionDomain.SubmissionJudgeContext> {
  return submissionDomain.getJudgeContext(submissionId);
}

// Student files may override only `editable` workspace files; readonly/hidden
// teacher files always win on path collision.
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
    // No workspace files configured — single-file submission path.
    return {
      sourceCode: draft.sourceCode,
      ...(draft.sourceFiles ? { sourceFiles: draft.sourceFiles } : {})
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

  // Workspace-mode convention: the entry file is ALWAYS `main.<ext>`,
  // ignoring any client-provided `draft.entryFile`. Keeps the server
  // authoritative and matches the admin UI invariant that every enabled
  // language ships exactly one editable `main.<ext>`.
  const mainPath = entryFileNameFor(draft.language);
  if (draft.sourceCode && editablePaths.has(mainPath)) {
    merged.set(mainPath, draft.sourceCode);
  }

  const sourceFiles = Array.from(merged.entries()).map(([path, content]) => ({
    path,
    content
  }));

  return {
    sourceCode: merged.get(mainPath) ?? draft.sourceCode,
    sourceFiles,
    entryFile: mainPath
  };
}

export async function executeSandbox(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: submissionDomain.SubmissionJudgeContext
): Promise<SubmissionResult> {
  const executor = getExecutor();

  await submissionDomain.updateSubmissionStatus(submissionId, "running");

  // Starter code + teacher assets flow through ProblemWorkspaceFile /
  // mergeSandboxSources. Sample path: either the student-supplied run
  // cases (from the editor bottom panel — ephemeral, never persisted)
  // or, when absent, Problem.samples directly. Graded path: iterate
  // testcase sets. Advanced-mode problems always bundle their own
  // testcases inside the TA image.
  const useSamples = draft.sampleOnly === true;
  const useAdvanced =
    judgeContext.problemType === "special_env" && judgeContext.advanced !== null;
  const hasRunCases =
    useSamples && !useAdvanced && draft.runCases !== undefined && draft.runCases.length > 0;

  const testcasesForSandbox = hasRunCases
    ? // `draft.runCases` is validated at the API edge
      // (submissionDraftSchema), so we can rely on the cap/size limits
      // having already been enforced before this runs.
      draft.runCases!.map((tc, i) => ({
        index: i,
        input: tc.input,
        ...(tc.expectedOutput !== undefined ? { output: tc.expectedOutput } : {}),
        weight: 0,
        isSample: true
      }))
    : useSamples
      ? judgeContext.samples.map((s, i) => ({
          index: i,
          input: s.input,
          output: s.output,
          weight: 0,
          isSample: true
        }))
      : useAdvanced
        ? // Advanced-mode TA images bundle their own testcases; the
          // system hands over student files + resource limits only.
          []
        : judgeContext.testcaseSets.flatMap((ts) =>
            ts.testcases.map((tc, i) => ({
              index: i,
              input: tc.input,
              ...(tc.output != null ? { output: tc.output } : {}),
              weight: tc.weight,
              isSample: false
            }))
          );

  const activeSets = useSamples || useAdvanced ? [] : judgeContext.testcaseSets;

  const sources = mergeSandboxSources(draft, judgeContext);

  // Build the advanced-mode payload when applicable. In the v2 contract
  // the TA image bundles its own testcases; the system only hands over
  // student files + resource limits.
  let advancedPayload: SandboxRequest["advanced"] | undefined;
  if (judgeContext.problemType === "special_env" && judgeContext.advanced) {
    const ctx = judgeContext.advanced;
    advancedPayload = {
      imageRef: ctx.imageRef,
      imageSource: ctx.imageSource,
      totalTimeMs: ctx.resourceLimits.totalTimeMs,
      memoryMb: ctx.resourceLimits.memoryMb
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
        : {})
    },
    limits: {
      timeoutMs: judgeContext.runtime.timeLimitMs,
      memoryMb: judgeContext.runtime.memoryLimitMb
    },
    ...(advancedPayload ? { advanced: advancedPayload } : {})
  };

  const result = await executor.execute(request);

  // Sample runs don't apply scoring/adjustments — they're for student
  // feedback only and never go to final grades.
  if (useSamples) {
    const mapped = submissionDomain.mapResult(result, [], judgeContext);
    mapped.score = 0;
    return submissionResultSchema.parse(mapped);
  }

  return submissionResultSchema.parse(
    submissionDomain.mapResult(result, activeSets, judgeContext)
  );
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
