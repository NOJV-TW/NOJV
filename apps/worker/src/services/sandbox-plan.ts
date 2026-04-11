import { sourceExtensions, type SandboxRequest, type SandboxResult } from "@nojv/core";

/**
 * Return the file extension (without leading dot) for a language's
 * source/script files. Defaults to `py` for unknown/missing languages.
 */
export function sourceExtension(language: string | undefined): string {
  if (language && language in sourceExtensions) {
    return sourceExtensions[language as SandboxRequest["language"]];
  }
  return "py";
}

/**
 * Build the `config.json` object consumed by the sandbox runner.
 * `sourceFileMap` is the `{ path, key }` mapping for multi-file
 * submissions — Docker uses `key === path`, K8s uses synthetic
 * ConfigMap keys since ConfigMaps can't hold nested directories.
 */
export function buildSandboxConfigJson(
  request: SandboxRequest,
  sourceFileMap: { path: string; key: string }[]
): Record<string, unknown> {
  return {
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    // `problemType` is the single source of truth on Problem. The
    // on-disk config key matches the sandbox-runner's parser.
    problemType: request.problemType,
    limits: request.limits,
    ...(request.entryFile ? { entryFile: request.entryFile } : {}),
    ...(request.judgeConfig.checkerLanguage
      ? { checkerLanguage: request.judgeConfig.checkerLanguage }
      : {}),
    ...(request.judgeConfig.interactorLanguage
      ? { interactorLanguage: request.judgeConfig.interactorLanguage }
      : {}),
    ...(request.compare ? { compare: request.compare } : {}),
    ...(sourceFileMap.length > 0 ? { sourceFileMap } : {})
  };
}

/** Build a single-testcase SE result for unrecoverable sandbox failures. */
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
        feedback: message
      }
    ]
  };
}
