import type { SandboxRequest, SandboxResult } from "@nojv/core";

export function buildSandboxConfigJson(
  request: SandboxRequest,
  sourceFileMap: { path: string; key: string }[],
): Record<string, unknown> {
  return {
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    ...(request.entryFile ? { entryFile: request.entryFile } : {}),
    ...(request.judgeConfig.checkerLanguage
      ? { checkerLanguage: request.judgeConfig.checkerLanguage }
      : {}),
    ...(request.judgeConfig.interactorLanguage
      ? { interactorLanguage: request.judgeConfig.interactorLanguage }
      : {}),
    ...(sourceFileMap.length > 0 ? { sourceFileMap } : {}),
  };
}

export function sandboxSystemError(message: string, stdout = ""): SandboxResult {
  return {
    testcaseResults: [
      {
        index: 0,
        verdict: "SE",
        stdout,
        stderr: message,
        exitCode: -1,
        timeMs: 0,
        feedback: message,
      },
    ],
  };
}
