import { sourceExtensions, type SandboxRequest } from "@nojv/core";

import { buildSandboxConfigJson } from "./sandbox-plan";
import { resolveSourceFiles } from "./source-files";

export type StagePayload = Record<string, string>;

function caseIndices(request: SandboxRequest): number[] {
  return request.testcases.map((tc) => tc.index);
}

function sourcePayload(request: SandboxRequest, stage: Record<string, unknown>): StagePayload {
  const data: StagePayload = {};
  const sourceFileMap = resolveSourceFiles(request).map((sf, index) => {
    const key = `source-file-${String(index)}`;
    data[key] = sf.content;
    return { path: sf.path, key };
  });
  data["config.json"] = JSON.stringify({
    ...buildSandboxConfigJson(request, sourceFileMap),
    ...stage,
  });
  return data;
}

export function buildRunPayload(request: SandboxRequest, parallelism: number): StagePayload {
  const data = sourcePayload(request, {
    mode: { kind: "run-stage", caseIndices: caseIndices(request), parallelism },
  });
  for (const tc of request.testcases) {
    data[`testcase-${String(tc.index)}-input.txt`] = tc.input;
  }
  return data;
}

export function buildInteractiveSolutionPayload(request: SandboxRequest): StagePayload {
  return sourcePayload(request, {
    interactive: { role: "solution", cases: caseIndices(request) },
  });
}

export function buildInteractiveInteractorPayload(request: SandboxRequest): StagePayload {
  const interactorScript = request.judgeConfig.interactorScript;
  if (!interactorScript) throw new Error("Interactive judge is missing its interactor script.");
  const interactorLanguage = request.judgeConfig.interactorLanguage;
  if (!interactorLanguage) throw new Error("Interactive judge is missing interactorLanguage.");

  const data: StagePayload = {
    [`interactor.${sourceExtensions[interactorLanguage]}`]: interactorScript,
  };
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
      cases: caseIndices(request),
    },
  });
  return data;
}

export function buildJudgePayload(request: SandboxRequest): StagePayload {
  const data: StagePayload = {};
  const checker = request.judgeType === "checker";
  if (checker) {
    const validatorScript = request.judgeConfig.checkerScript;
    if (!validatorScript) throw new Error("Checker judge is missing its validator script.");
    const validatorLanguage = request.judgeConfig.checkerLanguage;
    if (!validatorLanguage) throw new Error("Checker judge is missing checkerLanguage.");
    data[`validator.${sourceExtensions[validatorLanguage]}`] = validatorScript;
  }
  for (const tc of request.testcases) {
    if (tc.output === undefined) continue;
    if (checker) data[`case-${String(tc.index)}-input.txt`] = tc.input;
    data[`case-${String(tc.index)}-answer.txt`] = tc.output;
  }
  data["config.json"] = JSON.stringify({
    submissionId: request.submissionId,
    language: request.language,
    judgeType: request.judgeType,
    problemType: request.problemType,
    limits: request.limits,
    ...(request.judgeConfig.compare ? { compare: request.judgeConfig.compare } : {}),
    ...(checker && request.judgeConfig.checkerLanguage
      ? { validate: { language: request.judgeConfig.checkerLanguage } }
      : {}),
    mode: { kind: "judge-stage" },
  });
  return data;
}
