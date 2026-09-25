import type { SandboxAdvancedRequest, SandboxRequest } from "@nojv/core";

import type { ResolvedSourceFile } from "./source-files";

export const ADVANCED_WORKSPACE_MAX_BYTES = 1024 * 1024 * 1024;
export const ADVANCED_OUTPUT_MAX_FILES = 100_000;

export type RunState = "exited" | "timed_out" | "oom_killed";

export interface RunStatus {
  state: RunState;
  exitCode: number | null;
}

export type AdvancedResourceLimits = Pick<SandboxAdvancedRequest, "totalTimeMs" | "memoryMb">;

export interface AdvancedGradeMeta {
  submissionId: string;
  language: string;
  runStatus: RunStatus;
  maxScore: number;
}

export function advancedRunMeta(
  request: SandboxRequest,
  limits: AdvancedResourceLimits,
  submissionFiles: readonly ResolvedSourceFile[],
) {
  return {
    submissionId: request.submissionId,
    language: request.language,
    submissionFiles: submissionFiles.map((file) => file.path),
    resourceLimits: { totalTimeMs: limits.totalTimeMs, memoryMb: limits.memoryMb },
  };
}
