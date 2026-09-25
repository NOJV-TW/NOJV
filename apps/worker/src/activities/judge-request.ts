import {
  effectiveTimeLimitMs,
  entryFileNameFor,
  mergeWorkspaceSources,
  submissionResultSchema,
  type Language,
  type SandboxRequest,
  type SandboxResult,
  type SubmissionJudgeDraft,
  type SubmissionResult,
} from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import type { SubmissionSource } from "@nojv/storage";

import { enforceMemoryLimit } from "../sandbox/shared/check-standard";

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

export interface SandboxRequestInput {
  submissionId: string;
  draft: SubmissionJudgeDraft;
  context: submissionDomain.SubmissionJudgeContext;
  sources: readonly SubmissionSource[];
  sandboxImage?: string;
}

export function buildSandboxRequest({
  submissionId,
  draft,
  context: judgeContext,
  sources: studentSources,
  sandboxImage,
}: SandboxRequestInput): SandboxRequest {
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

  const sources = mergeSandboxSources(studentSources, draft.language, judgeContext);

  const advancedPayload = buildAdvancedPayload(judgeContext);
  return {
    submissionId,
    ...(sandboxImage !== undefined ? { sandboxImage } : {}),
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
}

export function mapSandboxResult(
  result: SandboxResult,
  {
    draft,
    context,
    testcaseCount,
  }: {
    draft: SubmissionJudgeDraft;
    context: submissionDomain.SubmissionJudgeContext;
    testcaseCount: number;
  },
): SubmissionResult {
  const advanced = context.problemType === "special_env";
  const mapped = submissionDomain.mapResult(
    {
      ...result,
      testcaseResults: enforceMemoryLimit(
        result.testcaseResults,
        context.runtime.memoryLimitMb,
      ),
    },
    draft.sampleOnly || advanced ? [] : context.testcaseSets,
    context,
    advanced ? undefined : testcaseCount,
  );
  if (draft.sampleOnly) mapped.score = 0;
  return submissionResultSchema.parse(mapped);
}
