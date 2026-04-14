import type { SubmissionDraft, SubmissionJudgeJob } from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";

import { getClient } from "./client";

// Task queue names must match packages/temporal/src/task-queues.ts.
const JUDGE_TASK_QUEUE = "judge" as const;
const PLATFORM_TASK_QUEUE = "platform" as const;

// Mirrored from packages/temporal/src/types.ts to keep this package decoupled.
export interface SubmissionJudgeInput {
  submissionId: string;
  draft: SubmissionDraft;
}

export interface RejudgeInput {
  problemId: string;
  contestId?: string;
  assessmentId?: string;
}

export interface ContestLifecycleInput {
  contestId: string;
}

export interface AssessmentLifecycleInput {
  assessmentId: string;
}

export interface ExamAutoCloseInput {
  examId: string;
  // ISO-8601 timestamp. Wire format is a string so the Temporal payload
  // serializer is deterministic regardless of who built the input.
  endsAt: string;
}

export interface PlagiarismCheckInput {
  targetId: string;
  targetType: "courseAssessment" | "exam";
  triggeredById: string;
}

export type SubmissionJudgeStatus = "queued" | "compiling" | "running" | "completed" | "failed";

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";

export interface RejudgeProgress {
  completed: number;
  total: number;
}

export async function dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const client = await getClient();

  const input: SubmissionJudgeInput = {
    submissionId: validated.submissionId,
    draft: validated.draft
  };

  await client.workflow.start("submissionJudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `judge-${validated.submissionId}`,
    args: [input]
  });
}

export async function dispatchRejudge(input: RejudgeInput): Promise<void> {
  const client = await getClient();
  const suffix = input.contestId ?? input.assessmentId ?? input.problemId;

  await client.workflow.start("rejudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `rejudge-${suffix}-${String(Date.now())}`,
    args: [input]
  });
}

export async function dispatchContestLifecycle(input: ContestLifecycleInput): Promise<void> {
  const client = await getClient();

  await client.workflow.start("contestLifecycleWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `contest-lifecycle-${input.contestId}`,
    args: [input]
  });
}

export async function dispatchAssessmentLifecycle(
  input: AssessmentLifecycleInput
): Promise<void> {
  const client = await getClient();

  await client.workflow.start("assessmentLifecycleWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `assessment-lifecycle-${input.assessmentId}`,
    args: [input]
  });
}

/**
 * Schedule the durable timer that auto-closes every active session
 * for an exam at `endsAt`. The workflow id is keyed on `examId`, so
 * re-publishing the same exam terminates any pending workflow and
 * starts a fresh one — this is what enables the "edit endsAt and the
 * timer follows" flow without leaking workflows.
 */
export async function dispatchExamAutoClose(input: ExamAutoCloseInput): Promise<void> {
  const client = await getClient();

  await client.workflow.start("examAutoCloseWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `exam-auto-close-${input.examId}`,
    // If a previous auto-close workflow is still sleeping for this
    // exam (e.g. teacher edited `endsAt` and we're rescheduling),
    // terminate it so the new sleep window is authoritative.
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
    args: [input]
  });
}

export async function dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void> {
  const client = await getClient();

  await client.workflow.start("plagiarismCheckWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: plagiarismWorkflowId(input.targetType, input.targetId),
    args: [input]
  });
}

function plagiarismWorkflowId(
  targetType: PlagiarismCheckInput["targetType"],
  targetId: string
): string {
  return `plagiarism-${targetType}-${targetId}`;
}

export async function querySubmissionStatus(
  submissionId: string
): Promise<SubmissionJudgeStatus> {
  const client = await getClient();
  const handle = client.workflow.getHandle(`judge-${submissionId}`);
  return handle.query<SubmissionJudgeStatus>("getStatus");
}

export async function queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress> {
  const client = await getClient();
  const handle = client.workflow.getHandle(workflowId);
  return handle.query<RejudgeProgress>("getProgress");
}

export async function queryPlagiarismStatus(
  targetType: PlagiarismCheckInput["targetType"],
  targetId: string
): Promise<PlagiarismCheckStatus> {
  const client = await getClient();
  const handle = client.workflow.getHandle(plagiarismWorkflowId(targetType, targetId));
  return handle.query<PlagiarismCheckStatus>("getPlagiarismStatus");
}
