import { effectiveTimeLimitMs, type SandboxRequest } from "@nojv/core";
import { submissionDomain } from "@nojv/application";
import { buildAdvancedPayload, buildSandboxTestcases, mergeSandboxSources } from "./judge";

export function buildPinnedSandboxRequest(
  snapshot: submissionDomain.JudgeSnapshot,
): SandboxRequest {
  const { submissionId, draft, context: judgeContext, sources: studentSources } = snapshot;
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
  const request: SandboxRequest = {
    submissionId,
    sandboxImage: snapshot.sandboxImage,
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

  return request;
}
