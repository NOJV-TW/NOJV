import {
  evaluateIntegritySignals,
  type IntegrityAssessment,
  type ProblemJudgeTestcase,
  type SubmissionResult,
  type WorkspaceRunResult
} from "@nojv/domain";
import type { Prisma } from "../generated/prisma/client";

import { prisma } from "./client";

type TransactionClient = Prisma.TransactionClient;

function toInputJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type PersistedSubmissionStatus =
  | "accepted"
  | "compile_error"
  | "memory_limit_exceeded"
  | "queued"
  | "running"
  | "runtime_error"
  | "time_limit_exceeded"
  | "wrong_answer";
export type PersistedWorkspaceRunStatus =
  | "blocked"
  | "failed"
  | "queued"
  | "running"
  | "succeeded"
  | "timed_out";
export type PersistedCheatingCaseStatus = "open" | "resolved" | "under_review";

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

function mapWorkspaceRunResultToStatus(
  result: WorkspaceRunResult
): PersistedWorkspaceRunStatus {
  switch (result.status) {
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "succeeded":
      return "succeeded";
    case "timed_out":
      return "timed_out";
  }
}

function mapIntegrityAssessmentToCaseStatus(
  assessment: IntegrityAssessment
): PersistedCheatingCaseStatus {
  switch (assessment.recommendedAction) {
    case "escalate":
      return "open";
    case "monitor":
      return "resolved";
    case "review":
      return "under_review";
  }
}

function buildCheatingCaseSummary(assessment: IntegrityAssessment, signalCount: number) {
  const topReason = assessment.reasons[0] ?? "No reviewer reason provided.";

  return `score=${String(assessment.score)} level=${assessment.level} signals=${String(signalCount)} top=${topReason}`;
}

async function upsertShellPolicyCase(
  tx: TransactionClient,
  input: {
    confidence: number;
    contestId: string | null;
    contestParticipationId: string | null;
    courseAssessmentId: string | null;
    courseId: string | null;
    occurredAt: Date;
    payload: Record<string, unknown>;
    userId: string;
    workspaceRunId: string;
    workspaceSessionId: string;
  }
) {
  const assessment = evaluateIntegritySignals([
    {
      capturedAt: input.occurredAt.toISOString(),
      confidence: input.confidence,
      payload: input.payload,
      sessionId: input.workspaceSessionId,
      source: input.contestId ? "contest_workspace" : "workspace_terminal",
      type: "shell_policy_violation",
      userId: input.userId
    }
  ]);
  const existingCase = await tx.cheatingCase.findFirst({
    orderBy: {
      openedAt: "desc"
    },
    where: {
      contestId: input.contestId,
      courseAssessmentId: input.courseAssessmentId,
      courseId: input.courseId,
      status: {
        in: ["open", "under_review"]
      },
      userId: input.userId
    }
  });
  const data = {
    contestId: input.contestId,
    courseAssessmentId: input.courseAssessmentId,
    courseId: input.courseId,
    score: assessment.score,
    status: mapIntegrityAssessmentToCaseStatus(assessment),
    summary: buildCheatingCaseSummary(assessment, 1),
    userId: input.userId
  } as const;
  const cheatingCase = existingCase
    ? await tx.cheatingCase.update({
        data,
        where: {
          id: existingCase.id
        }
      })
    : await tx.cheatingCase.create({
        data
      });

  await tx.cheatingSignal.create({
    data: {
      cheatingCaseId: cheatingCase.id,
      confidence: input.confidence,
      contestParticipationId: input.contestParticipationId,
      courseAssessmentId: input.courseAssessmentId,
      courseId: input.courseId,
      occurredAt: input.occurredAt,
      payload: toInputJsonValue(input.payload),
      type: "shell_policy_violation",
      userId: input.userId,
      workspaceRunId: input.workspaceRunId,
      workspaceSessionId: input.workspaceSessionId
    }
  });
}

export async function markSubmissionRunning(submissionId: string) {
  return prisma.submission.update({
    data: {
      status: "running"
    },
    where: {
      id: submissionId
    }
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
    where: {
      id: submissionId
    }
  });
}

export async function markWorkspaceRunRunning(workspaceRunId: string) {
  const startedAt = new Date();
  const run = await prisma.workspaceRun.update({
    data: {
      startedAt,
      status: "running"
    },
    where: {
      id: workspaceRunId
    }
  });

  await prisma.workspaceSession.update({
    data: {
      lastHeartbeatAt: startedAt,
      status: "active"
    },
    where: {
      id: run.workspaceSessionId
    }
  });

  return run;
}

export async function completeWorkspaceRun(workspaceRunId: string, result: WorkspaceRunResult) {
  const finishedAt = new Date();
  const startedAt = new Date(finishedAt.getTime() - result.durationMs);

  return prisma.$transaction(async (tx) => {
    const workspaceRun = await tx.workspaceRun.update({
      data: {
        exitCode: result.exitCode,
        finishedAt,
        startedAt,
        status: mapWorkspaceRunResultToStatus(result),
        stderr: result.stderr,
        stdout: result.stdout
      },
      include: {
        contestParticipation: {
          include: {
            contest: true
          }
        }
      },
      where: {
        id: workspaceRunId
      }
    });

    await tx.workspaceSession.update({
      data: {
        endedAt: finishedAt,
        lastHeartbeatAt: finishedAt,
        status: result.status === "succeeded" ? "completed" : "attention_required"
      },
      where: {
        id: workspaceRun.workspaceSessionId
      }
    });

    if (result.status === "blocked") {
      await upsertShellPolicyCase(tx, {
        confidence: 0.96,
        contestId: workspaceRun.contestParticipation?.contest.id ?? null,
        contestParticipationId: workspaceRun.contestParticipationId,
        courseAssessmentId: workspaceRun.courseAssessmentId,
        courseId: workspaceRun.courseId,
        occurredAt: finishedAt,
        payload: {
          command: workspaceRun.command,
          source:
            workspaceRun.mode === "contest" || workspaceRun.mode === "exam"
              ? "contest_workspace"
              : "workspace_terminal",
          stderr: result.stderr
        },
        userId: workspaceRun.userId,
        workspaceRunId: workspaceRun.id,
        workspaceSessionId: workspaceRun.workspaceSessionId
      });
    }

    return workspaceRun;
  });
}

export async function getSubmissionOperation(submissionId: string) {
  return prisma.submission.findUnique({
    where: {
      id: submissionId
    }
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
              testcases: {
                orderBy: {
                  ordinal: "asc"
                }
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }
    },
    where: {
      id: submissionId
    }
  });

  if (!submission) {
    return null;
  }

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

export async function getWorkspaceRunOperation(workspaceRunId: string) {
  return prisma.workspaceRun.findUnique({
    where: {
      id: workspaceRunId
    }
  });
}

export {
  buildCheatingCaseSummary,
  mapIntegrityAssessmentToCaseStatus,
  mapSubmissionResultToStatus,
  mapWorkspaceRunResultToStatus
};
