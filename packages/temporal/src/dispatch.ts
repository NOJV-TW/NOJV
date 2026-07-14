import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";

import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
  LifecycleScheduleIdentity,
  PlagiarismCheckInput,
  RegistryGarbageCollectInput,
  RejudgeInput,
  RejudgeProgress,
  SubmissionJudgeInput,
  SubmissionJudgeJob,
} from "@nojv/core";
import { submissionJudgeJobSchema } from "@nojv/core";

import { getTemporalClient } from "./client";
import {
  decideLifecycleReconciliation,
  type LifecycleReconciliationMode,
  type ObservedLifecycleRun,
} from "./lifecycle-reconciliation";
import { JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE } from "./task-queues";

export async function dispatchSubmissionJudge(payload: SubmissionJudgeJob): Promise<void> {
  const validated = submissionJudgeJobSchema.parse(payload);
  const client = await getTemporalClient();

  const input: SubmissionJudgeInput = {
    submissionId: validated.submissionId,
    draft: validated.draft,
  };

  try {
    await client.workflow.start("submissionJudgeWorkflow", {
      taskQueue: JUDGE_TASK_QUEUE,
      workflowId: `judge-${validated.submissionId}`,
      args: [input],
    });
  } catch (reason) {
    if (reason instanceof WorkflowExecutionAlreadyStartedError) return;
    throw reason;
  }
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

export interface SubmissionJudgeState {
  status: string;
  running: boolean;
}

export async function describeSubmissionJudge(
  submissionId: string,
): Promise<SubmissionJudgeState | null> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(`judge-${submissionId}`);
  try {
    const description = await handle.describe();
    const status = description.status.name;
    return { status, running: status === "RUNNING" };
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return null;
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

export const LIFECYCLE_RECONCILER_WORKFLOW_ID = "lifecycle-timer-reconciler";

export async function ensureLifecycleReconciler(): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("lifecycleReconcilerWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: LIFECYCLE_RECONCILER_WORKFLOW_ID,
      cronSchedule: "*/5 * * * *",
      args: [],
    });
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return;
    throw err;
  }
}

export const DURABLE_WORK_WORKFLOW_ID = "durable-work-processor";

export async function ensureDurableWorkProcessor(): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("durableWorkWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: DURABLE_WORK_WORKFLOW_ID,
      cronSchedule: "* * * * *",
      args: [],
    });
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return;
    throw err;
  }
}

export const REGISTRY_GC_WORKFLOW_ID = "registry-gc";

export async function dispatchRegistryGarbageCollect(
  input: RegistryGarbageCollectInput,
): Promise<{ workflowId: string; alreadyRunning: boolean }> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("registryGarbageCollectWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: REGISTRY_GC_WORKFLOW_ID,
      memo: { triggeredByUserId: input.triggeredByUserId },
      args: [input],
    });
    return { workflowId: REGISTRY_GC_WORKFLOW_ID, alreadyRunning: false };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return { workflowId: REGISTRY_GC_WORKFLOW_ID, alreadyRunning: true };
    }
    throw err;
  }
}

export async function dispatchRejudge(
  input: RejudgeInput,
  workflowId: string,
): Promise<{ workflowId: string }> {
  const client = await getTemporalClient();
  try {
    await client.workflow.start("rejudgeWorkflow", {
      taskQueue: JUDGE_TASK_QUEUE,
      workflowId,
      memo: { triggeredByUserId: input.triggeredByUserId },
      args: [input],
    });
  } catch (reason) {
    if (!(reason instanceof WorkflowExecutionAlreadyStartedError)) throw reason;
  }
  return { workflowId };
}

export async function getRejudgeTriggeredBy(workflowId: string): Promise<string | null> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  try {
    const description = await handle.describe();
    const value = description.memo?.triggeredByUserId;
    return typeof value === "string" ? value : null;
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return null;
    throw err;
  }
}

interface LifecycleWorkflowSpec<T extends LifecycleScheduleIdentity> {
  input: T;
  mode: LifecycleReconciliationMode;
  workflowId: string;
  workflowType: string;
}

const MAX_LIFECYCLE_RECONCILIATION_ATTEMPTS = 8;

async function describeLifecycleRun(workflowId: string): Promise<ObservedLifecycleRun | null> {
  const client = await getTemporalClient();
  try {
    const description = await client.workflow.getHandle(workflowId).describe();
    const revision = description.memo?.scheduleRevision;
    const fingerprint = description.memo?.timerFingerprint;
    return {
      runId: description.runId,
      scheduleRevision:
        typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
          ? revision
          : -1,
      status: description.status.name,
      timerFingerprint:
        typeof fingerprint === "string" && fingerprint.length > 0 ? fingerprint : "",
    };
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return null;
    throw err;
  }
}

async function terminateLifecycleRun(
  workflowId: string,
  runId: string,
  reason: string,
): Promise<void> {
  const client = await getTemporalClient();
  try {
    await client.workflow.getHandle(workflowId, runId).terminate(reason);
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return;
    throw err;
  }
}

async function reconcileLifecycleWorkflow<T extends LifecycleScheduleIdentity>({
  input,
  mode,
  workflowId,
  workflowType,
}: LifecycleWorkflowSpec<T>): Promise<void> {
  const client = await getTemporalClient();

  for (let attempt = 0; attempt < MAX_LIFECYCLE_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const observed = await describeLifecycleRun(workflowId);
    const decision = decideLifecycleReconciliation(mode, input, observed);

    if (decision === "keep") return;
    if (decision === "terminate" || decision === "terminate-and-start") {
      if (!observed) throw new Error("Lifecycle reconciliation lost its observed run.");
      await terminateLifecycleRun(
        workflowId,
        observed.runId,
        `${mode} schedule revision ${String(input.scheduleRevision)}`,
      );
      if (decision === "terminate") return;
      continue;
    }

    try {
      await client.workflow.start(workflowType, {
        taskQueue: PLATFORM_TASK_QUEUE,
        workflowId,
        workflowIdConflictPolicy: "USE_EXISTING",
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
        memo: {
          scheduleRevision: input.scheduleRevision,
          timerFingerprint: input.timerFingerprint,
        },
        args: [input],
      });
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
    }
  }

  throw new Error(`Lifecycle reconciliation did not converge for ${workflowId}.`);
}

function contestLifecycleSpec(
  mode: LifecycleReconciliationMode,
  input: ContestLifecycleInput,
): LifecycleWorkflowSpec<ContestLifecycleInput> {
  return {
    input,
    mode,
    workflowId: `contest-lifecycle-${input.contestId}`,
    workflowType: "contestLifecycleWorkflow",
  };
}

function examAutoCloseSpec(
  mode: LifecycleReconciliationMode,
  input: ExamAutoCloseInput,
): LifecycleWorkflowSpec<ExamAutoCloseInput> {
  return {
    input,
    mode,
    workflowId: `exam-auto-close-${input.examId}`,
    workflowType: "examAutoCloseWorkflow",
  };
}

function assignmentDueSoonSpec(
  mode: LifecycleReconciliationMode,
  input: AssignmentDueSoonInput,
): LifecycleWorkflowSpec<AssignmentDueSoonInput> {
  return {
    input,
    mode,
    workflowId: `assignment-due-soon-${input.assignmentId}`,
    workflowType: "assignmentDueSoonWorkflow",
  };
}

export function ensureContestLifecycle(input: ContestLifecycleInput): Promise<void> {
  return reconcileLifecycleWorkflow(contestLifecycleSpec("ensure", input));
}

export function replaceContestLifecycle(input: ContestLifecycleInput): Promise<void> {
  return reconcileLifecycleWorkflow(contestLifecycleSpec("replace", input));
}

export function cancelContestLifecycle(input: ContestLifecycleInput): Promise<void> {
  return reconcileLifecycleWorkflow(contestLifecycleSpec("cancel", input));
}

export function ensureExamAutoClose(input: ExamAutoCloseInput): Promise<void> {
  return reconcileLifecycleWorkflow(examAutoCloseSpec("ensure", input));
}

export function replaceExamAutoClose(input: ExamAutoCloseInput): Promise<void> {
  return reconcileLifecycleWorkflow(examAutoCloseSpec("replace", input));
}

export function cancelExamAutoClose(input: ExamAutoCloseInput): Promise<void> {
  return reconcileLifecycleWorkflow(examAutoCloseSpec("cancel", input));
}

export function ensureAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void> {
  return reconcileLifecycleWorkflow(assignmentDueSoonSpec("ensure", input));
}

export function replaceAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void> {
  return reconcileLifecycleWorkflow(assignmentDueSoonSpec("replace", input));
}

export function cancelAssignmentDueSoon(input: AssignmentDueSoonInput): Promise<void> {
  return reconcileLifecycleWorkflow(assignmentDueSoonSpec("cancel", input));
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
