import {
  COMPILATION_TIMEOUT_MS,
  executionWallTimeLimitMs,
  validatorTimeoutMs,
  type SandboxRequest,
} from "@nojv/core";

import { resolveSourceFiles } from "./source-files.js";
import { buildSandboxConfigJson, sourceExtension } from "./sandbox-plan";

export const JOB_DEADLINE_FLOOR_SECONDS = 120;
const JOB_DEADLINE_CAP_SECONDS = 1_800;
const JOB_DEADLINE_BUFFER_SECONDS = 60;

export const CONFIGMAP_MAX_BYTES = 1_000_000;

function computePreparedJobDeadlineSeconds(executionBudgetMs: number): number {
  const compute =
    Math.ceil((COMPILATION_TIMEOUT_MS + executionBudgetMs) / 1000) +
    JOB_DEADLINE_BUFFER_SECONDS;
  return Math.min(Math.max(compute, JOB_DEADLINE_FLOOR_SECONDS), JOB_DEADLINE_CAP_SECONDS);
}

export function computeStageJobDeadlineSeconds(request: SandboxRequest): number {
  const cases = Math.max(1, request.testcases.length);
  const runMs = executionWallTimeLimitMs(request.limits.timeoutMs) * cases;
  const judgeMs =
    request.judgeType === "checker"
      ? COMPILATION_TIMEOUT_MS +
        executionWallTimeLimitMs(validatorTimeoutMs(request.limits.timeoutMs)) * cases
      : 0;
  return computePreparedJobDeadlineSeconds(runMs + judgeMs);
}

export function computeInteractiveJobDeadlineSeconds(request: SandboxRequest): number {
  const perCase = Math.max(
    executionWallTimeLimitMs(request.limits.timeoutMs),
    validatorTimeoutMs(request.limits.timeoutMs),
  );
  return computePreparedJobDeadlineSeconds(perCase * Math.max(1, request.testcases.length));
}

export function buildTestcaseConfigMapData(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};

  for (const tc of request.testcases) {
    data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
  }

  return data;
}

export function buildRunConfigMapData(
  request: SandboxRequest,
  parallelism: number,
): Record<string, string> {
  const data: Record<string, string> = {};
  const sourceFileMap: { path: string; key: string }[] = [];

  for (const sf of resolveSourceFiles(request)) {
    const key = `source-file-${String(sourceFileMap.length)}`;
    data[key] = sf.content;
    sourceFileMap.push({ path: sf.path, key });
  }

  data["config.json"] = JSON.stringify({
    ...buildSandboxConfigJson(request, sourceFileMap),
    mode: {
      kind: "run-stage",
      caseIndices: request.testcases.map((tc) => tc.index),
      parallelism,
    },
  });

  Object.assign(data, buildTestcaseConfigMapData(request));

  return data;
}

export function buildInteractiveSolutionConfigMapData(
  request: SandboxRequest,
): Record<string, string> {
  const data: Record<string, string> = {};
  const sourceFileMap: { path: string; key: string }[] = [];

  for (const sf of resolveSourceFiles(request)) {
    const key = `source-file-${String(sourceFileMap.length)}`;
    data[key] = sf.content;
    sourceFileMap.push({ path: sf.path, key });
  }

  data["config.json"] = JSON.stringify({
    ...buildSandboxConfigJson(request, sourceFileMap),
    interactive: { role: "solution", cases: request.testcases.map((tc) => tc.index) },
  });

  return data;
}

export function buildInteractiveInteractorConfigMapData(
  request: SandboxRequest,
): Record<string, string> {
  const interactorScript = request.judgeConfig.interactorScript;
  if (!interactorScript) throw new Error("Interactive judge is missing its interactor script.");
  const interactorLanguage = request.judgeConfig.interactorLanguage;
  if (!interactorLanguage) throw new Error("Interactive judge is missing interactorLanguage.");
  const ext = sourceExtension(interactorLanguage);

  const data: Record<string, string> = {};
  data[`interactor.${ext}`] = interactorScript;
  for (const testcase of request.testcases) {
    data[`case-${String(testcase.index)}-input.txt`] = testcase.input;
    data[`case-${String(testcase.index)}-answer.txt`] = testcase.output ?? "";
  }

  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    interactorLanguage,
    interactive: {
      role: "validator",
      language: interactorLanguage,
      cases: request.testcases.map((tc) => tc.index),
    },
  });

  return data;
}
