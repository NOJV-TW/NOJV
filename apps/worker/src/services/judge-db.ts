import { prisma } from "@nojv/db";
import type { ProblemJudgeTestcase, SubmissionResult } from "@nojv/core";

type PersistedSubmissionStatus =
  | "accepted"
  | "compile_error"
  | "memory_limit_exceeded"
  | "queued"
  | "running"
  | "runtime_error"
  | "time_limit_exceeded"
  | "wrong_answer";

function mapSubmissionResultToStatus(result: SubmissionResult): PersistedSubmissionStatus {
  switch (result.verdict) {
    case "accepted":
      return "accepted";
    case "compile_error":
      return "compile_error";
    case "runtime_error":
      return "runtime_error";
    case "time_limit_exceeded":
      return "time_limit_exceeded";
    case "memory_limit_exceeded":
      return "memory_limit_exceeded";
    case "wrong_answer":
      return "wrong_answer";
  }
}

export async function markSubmissionRunning(submissionId: string) {
  return prisma.submission.update({
    data: { status: "running" },
    where: { id: submissionId }
  });
}

export async function completeSubmission(submissionId: string, result: SubmissionResult) {
  return prisma.submission.update({
    data: {
      compilerOutput: result.verdict === "compile_error" ? result.feedback : null,
      runtimeMs: result.runtimeMs,
      score: result.score,
      status: mapSubmissionResultToStatus(result),
      verdictDetail: result
    },
    where: { id: submissionId }
  });
}

export interface SubmissionJudgeContext {
  checkerScript: string | null;
  interactorScript: string | null;
  judgeType: "standard" | "checker" | "interactive";
  memoryLimitMb: number;
  problemSlug: string;
  submissionType: "function" | "full_source";
  templates: {
    driverCode: string;
    insertionMarker: string;
    language: string;
    templateCode: string;
  }[];
  testcases: ProblemJudgeTestcase[];
  timeLimitMs: number;
}

export async function getSubmissionJudgeContext(
  submissionId: string
): Promise<SubmissionJudgeContext | null> {
  const submission = await prisma.submission.findUnique({
    include: {
      problem: {
        include: {
          templates: true,
          testcaseSets: {
            include: {
              testcases: { orderBy: { ordinal: "asc" } }
            },
            orderBy: { createdAt: "asc" }
          }
        }
      }
    },
    where: { id: submissionId }
  });

  if (!submission) return null;

  return {
    checkerScript: submission.problem.checkerScript,
    interactorScript: submission.problem.interactorScript,
    judgeType: submission.problem.judgeType,
    memoryLimitMb: submission.problem.memoryLimitMb,
    problemSlug: submission.problem.slug,
    submissionType: submission.problem.submissionType,
    templates: submission.problem.templates.map((t) => ({
      driverCode: t.driverCode,
      insertionMarker: t.insertionMarker,
      language: t.language,
      templateCode: t.templateCode
    })),
    testcases: submission.problem.testcaseSets.flatMap((testcaseSet) =>
      testcaseSet.testcases.map((testcase) => ({
        expectedStdout: testcase.expectedStdout ?? undefined,
        id: testcase.id,
        inputFiles: (testcase.inputFiles as Record<string, string> | null) ?? undefined,
        isHidden: testcaseSet.isHidden,
        stdin: testcase.stdin,
        weight: testcaseSet.weight
      }))
    ),
    timeLimitMs: submission.problem.timeLimitMs
  };
}
