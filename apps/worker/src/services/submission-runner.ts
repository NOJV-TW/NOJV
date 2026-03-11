import {
  submissionResultSchema,
  type SandboxExecutor,
  type SandboxRequest,
  type SandboxResult,
  type SubmissionDraft,
  type SubmissionResult
} from "@nojv/core";

import type { SubmissionJudgeContext } from "./judge-db.js";

const verdictMap: Record<string, SubmissionResult["verdict"]> = {
  WA: "wrong_answer",
  TLE: "time_limit_exceeded",
  MLE: "memory_limit_exceeded",
  RE: "runtime_error",
  SE: "runtime_error"
};

export async function judgeSubmission(
  submissionId: string,
  draft: SubmissionDraft,
  judgeContext: SubmissionJudgeContext,
  executor: SandboxExecutor
): Promise<SubmissionResult> {
  const template = judgeContext.templates.find((t) => t.language === draft.language);
  const testcases = draft.sampleOnly
    ? judgeContext.testcases.filter((tc) => !tc.isHidden)
    : judgeContext.testcases;

  const request: SandboxRequest = {
    submissionId,
    sourceCode: draft.sourceCode,
    language: draft.language as SandboxRequest["language"],
    submissionType: judgeContext.submissionType,
    testcases: testcases.map((tc, i) => ({
      index: i,
      input: tc.stdin,
      ...(tc.expectedStdout != null ? { expected: tc.expectedStdout } : {}),
      weight: tc.weight,
      isSample: !tc.isHidden
    })),
    judgeType: judgeContext.judgeType,
    judgeConfig: {
      ...(judgeContext.checkerScript != null
        ? { checkerScript: judgeContext.checkerScript }
        : {}),
      ...(judgeContext.interactorScript != null
        ? { interactorScript: judgeContext.interactorScript }
        : {})
    },
    limits: {
      timeoutMs: judgeContext.timeLimitMs,
      memoryMb: judgeContext.memoryLimitMb
    },
    ...(template
      ? {
          template: {
            driverCode: template.driverCode,
            insertionMarker: template.insertionMarker
          }
        }
      : {})
  };

  const result = await executor.execute(request);

  return submissionResultSchema.parse(mapResult(result));
}

function mapResult(result: SandboxResult): SubmissionResult {
  const caseResults = result.testcaseResults.map((t) => ({
    index: t.index,
    passed: t.verdict === "AC",
    stdout: t.stdout,
    timeMs: t.timeMs
  }));

  if (result.compilationError) {
    return {
      accepted: false,
      caseResults: [],
      feedback: result.compilationError,
      runtimeMs: 0,
      score: 0,
      verdict: "compile_error"
    };
  }

  // Score: average of per-testcase scores (each 0-100).
  // Falls back to binary 100/0 per testcase if score field is absent.
  const totalCases = result.testcaseResults.length;
  const scoreSum = result.testcaseResults.reduce(
    (s, t) => s + (t.score ?? (t.verdict === "AC" ? 100 : 0)),
    0
  );
  const score = totalCases > 0 ? Math.round(scoreSum / totalCases) : 0;
  const runtimeMs = result.testcaseResults.reduce((s, t) => s + t.timeMs, 0);

  if (result.testcaseResults.every((t) => t.verdict === "AC")) {
    return {
      accepted: true,
      caseResults,
      feedback: "All testcases passed",
      runtimeMs,
      score: 100,
      verdict: "accepted"
    };
  }

  const first = result.testcaseResults.find((t) => t.verdict !== "AC");
  if (!first) {
    return {
      accepted: true,
      caseResults,
      feedback: "All testcases passed",
      runtimeMs,
      score: 100,
      verdict: "accepted"
    };
  }

  const verdict = verdictMap[first.verdict] ?? "runtime_error";
  const feedback =
    first.feedback ??
    `Failed on testcase ${String(first.index + 1)}: ${verdict.replace(/_/g, " ")}`;

  return { accepted: false, caseResults, feedback, runtimeMs, score, verdict };
}
