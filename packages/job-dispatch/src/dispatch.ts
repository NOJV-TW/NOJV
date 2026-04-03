import type { SubmissionDraft, SubmissionJudgeJob } from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";

import { getClient } from "./client";

// ---------------------------------------------------------------------------
// Task queues — must match packages/temporal/src/task-queues.ts
// ---------------------------------------------------------------------------

const JUDGE_TASK_QUEUE = "judge" as const;
const PLATFORM_TASK_QUEUE = "platform" as const;

// ---------------------------------------------------------------------------
// Workflow input types — mirrors packages/temporal/src/types.ts
// We duplicate rather than importing from @nojv/temporal so this package
// stays decoupled from the worker-side dependency graph.
// ---------------------------------------------------------------------------

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

export interface PlagiarismCheckInput {
  reportId: string;
  targetId: string;
  targetType: "courseAssessment" | "contest";
  triggeredById: string;
}

// ---------------------------------------------------------------------------
// Query / status types
// ---------------------------------------------------------------------------

export type SubmissionJudgeStatus = "queued" | "compiling" | "running" | "completed" | "failed";

export type PlagiarismCheckStatus = "pending" | "running" | "completed" | "failed";

export interface RejudgeProgress {
  completed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Dispatch functions
// ---------------------------------------------------------------------------

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

export async function dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void> {
  const client = await getClient();

  await client.workflow.start("plagiarismCheckWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `plagiarism-${input.reportId}`,
    args: [input]
  });
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

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

export async function queryPlagiarismStatus(reportId: string): Promise<PlagiarismCheckStatus> {
  const client = await getClient();
  const handle = client.workflow.getHandle(`plagiarism-${reportId}`);
  return handle.query<PlagiarismCheckStatus>("getPlagiarismStatus");
}
