import type { RawCaseRun, SandboxRequest, SandboxTestcase } from "@nojv/core";

import { resolveSourceFiles } from "./source-files.js";
import { buildSandboxConfigJson, sourceExtension } from "./sandbox-plan";

const JOB_DEADLINE_FLOOR_SECONDS = 120;
const JOB_DEADLINE_CAP_SECONDS = 1_800;
const JOB_DEADLINE_BUFFER_SECONDS = 60;

export const CONFIGMAP_MAX_BYTES = 1_000_000;

export function computeJobDeadlineSeconds(request: SandboxRequest): number {
  const numCases = Math.max(1, request.testcases.length);
  const compute =
    Math.ceil((request.limits.timeoutMs * numCases) / 1000) + JOB_DEADLINE_BUFFER_SECONDS;
  return Math.min(Math.max(compute, JOB_DEADLINE_FLOOR_SECONDS), JOB_DEADLINE_CAP_SECONDS);
}

export function buildTestcaseConfigMapData(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};

  for (const tc of request.testcases) {
    data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
  }

  return data;
}

export function buildRunConfigMapData(request: SandboxRequest): Record<string, string> {
  const data: Record<string, string> = {};
  const sourceFileMap: { path: string; key: string }[] = [];

  for (const sf of resolveSourceFiles(request)) {
    const key = `source-file-${String(sourceFileMap.length)}`;
    data[key] = sf.content;
    sourceFileMap.push({ path: sf.path, key });
  }

  data["config.json"] = JSON.stringify(buildSandboxConfigJson(request, sourceFileMap));

  Object.assign(data, buildTestcaseConfigMapData(request));

  return data;
}

export function buildValidateConfigMapData(
  request: SandboxRequest,
  rawRuns: RawCaseRun[],
): Record<string, string> {
  const data: Record<string, string> = {};
  const validatorScript = request.judgeConfig.checkerScript ?? "";
  const validatorLanguage = request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";
  const ext = sourceExtension(validatorLanguage);
  data[`validator.${ext}`] = validatorScript;

  const tcByIndex = new Map(request.testcases.map((tc) => [tc.index, tc]));
  const cases: { index: number }[] = [];
  for (const run of rawRuns) {
    if (run.errorVerdict) continue;
    const tc = tcByIndex.get(run.index);
    if (tc?.output === undefined) continue;
    cases.push({ index: run.index });
    data[`case-${String(run.index)}-input.txt`] = tc.input;
    data[`case-${String(run.index)}-answer.txt`] = tc.output;
    data[`case-${String(run.index)}-team.txt`] = run.stdout;
  }

  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: "checker",
    problemType: request.problemType,
    limits: request.limits,
    validate: { language: validatorLanguage, cases },
  });

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
    interactive: { role: "solution" },
  });

  return data;
}

export function buildInteractiveInteractorConfigMapData(
  request: SandboxRequest,
  testcase: SandboxTestcase,
): Record<string, string> {
  const interactorScript = request.judgeConfig.interactorScript ?? "";
  const checkerFallbackLanguage =
    request.judgeConfig.checkerLanguage === "cpp" ? "cpp" : "python";
  const interactorLanguage =
    request.judgeConfig.interactorLanguage === "cpp" ? "cpp" : checkerFallbackLanguage;
  const ext = sourceExtension(interactorLanguage);

  const data: Record<string, string> = {};
  data[`interactor.${ext}`] = interactorScript;
  data[`case-${String(testcase.index)}-input.txt`] = testcase.input;
  data[`case-${String(testcase.index)}-answer.txt`] = testcase.output ?? "";

  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    interactorLanguage,
    interactive: { role: "validator", language: interactorLanguage, index: testcase.index },
  });

  return data;
}
