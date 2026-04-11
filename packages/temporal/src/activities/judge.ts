import {
  entryFileNameFor,
  submissionResultSchema,
  type SandboxExecutor,
  type SandboxRequest,
  type SubmissionDraft,
  type SubmissionResult
} from "@nojv/core";
import { ForbiddenError, submissionDomain } from "@nojv/domain";

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

  // Enforce editableRegions: for every editable workspace file that
  // declares regions, the student's final content must match the
  // teacher's original line-for-line outside those ranges. Any tampering
  // throws — the judge activity converts the error to a user-visible
  // system-error verdict.
  for (const wf of langFiles) {
    if (wf.visibility !== "editable" || !wf.editableRegions) continue;
    const studentContent = merged.get(wf.path);
    if (studentContent === undefined) continue;
    if (studentContent === wf.content) continue;

    const teacherLines = wf.content.split("\n");
    const studentLines = studentContent.split("\n");

    if (studentLines.length !== teacherLines.length) {
      throw new ForbiddenError(
        `Tampering detected in ${wf.path}: line count changed (expected ${String(
          teacherLines.length
        )}, got ${String(studentLines.length)}).`
      );
    }

    for (let i = 1; i <= teacherLines.length; i++) {
      const inRegion = wf.editableRegions.some(([start, end]) => i >= start && i <= end);
      if (inRegion) continue;
      if (studentLines[i - 1] !== teacherLines[i - 1]) {
        throw new ForbiddenError(
          `Tampering detected in ${wf.path}: line ${String(i)} is outside the editable region.`
        );
      }
    }
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
  // mergeSandboxSources. Sample path: ignore testcase sets, use
  // Problem.samples directly. Graded path: iterate testcase sets.
  const useSamples = draft.sampleOnly;
  const useAdvanced =
    judgeContext.problemType === "special_env" && judgeContext.advanced !== null;

  const testcasesForSandbox = useSamples
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
    ...(judgeContext.compare ? { compare: judgeContext.compare } : {}),
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
