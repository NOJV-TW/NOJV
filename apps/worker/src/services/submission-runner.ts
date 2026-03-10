import type { SubmissionJudgeContext } from "@nojv/db";
import {
  submissionResultSchema,
  type SubmissionDraft,
  type SubmissionResult
} from "@nojv/domain";

import type { SandboxExecutor, SandboxRequest, SandboxResult } from "./sandbox-executor.js";

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

  const request: SandboxRequest = {
    submissionId,
    sourceCode: draft.sourceCode,
    language: draft.language as SandboxRequest["language"],
    submissionType: judgeContext.submissionType,
    testcases: judgeContext.testcases.map((tc, i) => ({
      index: i,
      input: tc.stdin,
      ...(tc.expectedStdout != null ? { expected: tc.expectedStdout } : {}),
      weight: tc.weight,
      isSample: !tc.isHidden
    })),
    judgeType: judgeContext.judgeType,
    judgeConfig: {
      ...(judgeContext.checkerScript != null ? { checkerScript: judgeContext.checkerScript } : {}),
      ...(judgeContext.interactorScript != null ? { interactorScript: judgeContext.interactorScript } : {}),
    },
    limits: {
      timeoutMs: judgeContext.timeLimitMs,
      memoryMb: judgeContext.memoryLimitMb
    },
    ...(template ? { template: { driverCode: template.driverCode, insertionMarker: template.insertionMarker } } : {})
  };

  const result = await executor.execute(request);

  return submissionResultSchema.parse(mapResult(result));
}

function mapResult(result: SandboxResult): SubmissionResult {
  if (result.compilationError) {
    return { accepted: false, feedback: result.compilationError, runtimeMs: 0, score: 0, verdict: "compile_error" };
  }

  const totalWeight = result.testcaseResults.reduce((s, t) => s + (t.score ?? 0), 0) || result.testcaseResults.length;
  const passedWeight = result.testcaseResults
    .filter((t) => t.verdict === "AC")
    .reduce((s, t) => s + (t.score ?? 1), 0);
  const score = Math.round((passedWeight / totalWeight) * 100);
  const runtimeMs = result.testcaseResults.reduce((s, t) => s + t.timeMs, 0);

  if (result.testcaseResults.every((t) => t.verdict === "AC")) {
    return { accepted: true, feedback: "All testcases passed", runtimeMs, score: 100, verdict: "accepted" };
  }

  const first = result.testcaseResults.find((t) => t.verdict !== "AC");
  if (!first) {
    return { accepted: true, feedback: "All testcases passed", runtimeMs, score: 100, verdict: "accepted" };
  }

  const verdict = verdictMap[first.verdict] ?? "runtime_error";
  const feedback =
    first.feedback ?? `Failed on testcase ${String(first.index + 1)}: ${verdict.replace(/_/g, " ")}`;

  return { accepted: false, feedback, runtimeMs, score, verdict };
}
