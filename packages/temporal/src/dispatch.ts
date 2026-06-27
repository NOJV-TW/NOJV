import { randomUUID } from "node:crypto";

import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";

import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
  PlagiarismCheckInput,
  RejudgeInput,
  RejudgeProgress,
  SubmissionJudgeInput,
  SubmissionJudgeJob,
} from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";

import { getTemporalClient } from "./client";
import { JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE } from "./task-queues";

export async function dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const client = await getTemporalClient();

  const input: SubmissionJudgeInput = {
    submissionId: validated.submissionId,
    draft: validated.draft,
  };

  await client.workflow.start("submissionJudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId: `judge-${validated.submissionId}`,
    args: [input],
  });
}

export async function terminateSubmissionJudge(
  submissionId: string,
  reason: string,
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(`judge-${submissionId}`);
  try {
    await handle.terminate(reason);
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return;
    throw err;
  }
}

export const SUBMISSION_SWEEPER_WORKFLOW_ID = "submission-pending-sweeper";

export async function ensureSubmissionSweeper(): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("submissionSweeperWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: SUBMISSION_SWEEPER_WORKFLOW_ID,
      cronSchedule: "* * * * *",
      args: [],
    });
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return;
    throw err;
  }
}

export async function dispatchRejudge(input: RejudgeInput): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();
  const suffix =
    input.mode === "single"
      ? input.submissionId
      : (input.examId ?? input.contestId ?? input.assessmentId ?? input.problemId);

  const workflowId = `rejudge-${suffix}-${randomUUID()}`;
  await client.workflow.start("rejudgeWorkflow", {
    taskQueue: JUDGE_TASK_QUEUE,
    workflowId,
    args: [input],
  });
  return { workflowId };
}

export async function dispatchContestLifecycle(input: ContestLifecycleInput): Promise<void> {
  const client = await getTemporalClient();

  await client.workflow.start("contestLifecycleWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `contest-lifecycle-${input.contestId}`,
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
    args: [input],
  });
}

export async function dispatchExamAutoClose(input: ExamAutoCloseInput): Promise<void> {
  const client = await getTemporalClient();

  await client.workflow.start("examAutoCloseWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `exam-auto-close-${input.examId}`,
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
    args: [input],
  });
}

export async function dispatchAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void> {
  const client = await getTemporalClient();

  await client.workflow.start("assignmentDueSoonWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: `assignment-due-soon-${input.assignmentId}`,
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
    args: [input],
  });
}

export async function dispatchPlagiarismCheck(input: PlagiarismCheckInput): Promise<void> {
  const client = await getTemporalClient();

  await client.workflow.start("plagiarismCheckWorkflow", {
    taskQueue: PLATFORM_TASK_QUEUE,
    workflowId: plagiarismWorkflowId(input.targetType, input.targetId),
    workflowIdConflictPolicy: "TERMINATE_EXISTING",
    args: [input],
  });
}

function plagiarismWorkflowId(
  targetType: PlagiarismCheckInput["targetType"],
  targetId: string,
): string {
  return `plagiarism-${targetType}-${targetId}`;
}

export async function queryRejudgeProgress(workflowId: string): Promise<RejudgeProgress> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  return handle.query<RejudgeProgress>("getProgress");
}

export async function cancelRejudge(workflowId: string): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  await handle.cancel();
}
