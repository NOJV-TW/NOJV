import { sourceExtensions, type SandboxRequest, type SandboxText } from "@nojv/core";

import { buildSandboxConfigJson } from "./sandbox-plan";
import { resolveSourceFiles } from "./source-files";

export type StagePayload = Record<string, string>;

export interface StageTestcaseFile {
  path: string;
  role: "input" | "answer";
  text: SandboxText;
}

export interface StagePayloadParts {
  stage: StagePayload;
  testcases: StageTestcaseFile[];
}

export function inlineStagePayload({ stage, testcases }: StagePayloadParts): StagePayload {
  const data = { ...stage };
  for (const { path, text } of testcases) {
    if (typeof text !== "string")
      throw new Error(`Testcase ${path} must be loaded before it is written inline.`);
    data[path] = text;
  }
  return data;
}

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

export function buildRunStage(request: SandboxRequest, parallelism: number): StagePayloadParts {
  return {
    stage: sourcePayload(request, {
      mode: { kind: "run-stage", caseIndices: caseIndices(request), parallelism },
    }),
    testcases: request.testcases.map((tc) => ({
      path: `testcase-${String(tc.index)}-input.txt`,
      role: "input",
      text: tc.input,
    })),
  };
}

export function buildRunPayload(request: SandboxRequest, parallelism: number): StagePayload {
  return inlineStagePayload(buildRunStage(request, parallelism));
}

export function buildInteractiveSolutionPayload(request: SandboxRequest): StagePayload {
  return sourcePayload(request, {
    interactive: { role: "solution", cases: caseIndices(request) },
  });
}

export function buildInteractiveInteractorStage(request: SandboxRequest): StagePayloadParts {
  const interactorScript = request.judgeConfig.interactorScript;
  if (!interactorScript) throw new Error("Interactive judge is missing its interactor script.");
  const interactorLanguage = request.judgeConfig.interactorLanguage;
  if (!interactorLanguage) throw new Error("Interactive judge is missing interactorLanguage.");

  const stage: StagePayload = {
    [`interactor.${sourceExtensions[interactorLanguage]}`]: interactorScript,
  };
  const testcases = request.testcases.flatMap((testcase): StageTestcaseFile[] => [
    { path: `case-${String(testcase.index)}-input.txt`, role: "input", text: testcase.input },
    {
      path: `case-${String(testcase.index)}-answer.txt`,
      role: "answer",
      text: testcase.output ?? "",
    },
  ]);
  stage["config.json"] = JSON.stringify({
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
  return { stage, testcases };
}

export function buildInteractiveInteractorPayload(request: SandboxRequest): StagePayload {
  return inlineStagePayload(buildInteractiveInteractorStage(request));
}

export function buildJudgeStage(request: SandboxRequest): StagePayloadParts {
  const data: StagePayload = {};
  const testcases: StageTestcaseFile[] = [];
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
    if (checker)
      testcases.push({
        path: `case-${String(tc.index)}-input.txt`,
        role: "input",
        text: tc.input,
      });
    testcases.push({
      path: `case-${String(tc.index)}-answer.txt`,
      role: "answer",
      text: tc.output,
    });
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
  return { stage: data, testcases };
}

export function buildJudgePayload(request: SandboxRequest): StagePayload {
  return inlineStagePayload(buildJudgeStage(request));
}
