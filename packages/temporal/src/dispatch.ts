import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";

import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
  JudgePriority,
  LifecycleScheduleIdentity,
  PlagiarismCheckInput,
  RegistryGarbageCollectInput,
} from "@nojv/core";

import { getTemporalClient } from "./client";
import {
  decideLifecycleReconciliation,
  type LifecycleReconciliationMode,
  type ObservedLifecycleRun,
} from "./lifecycle-reconciliation";
import { JUDGE_TASK_QUEUE, PLATFORM_TASK_QUEUE } from "./task-queues";

async function startUnlessRunning(start: Promise<unknown>): Promise<boolean> {
  try {
    await start;
    return true;
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) return false;
    throw err;
  }
}

export async function terminateSubmissionJudge(
  submissionId: string,
  reason: string,
  workflowId = `judge-${submissionId}`,
): Promise<void> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
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
  lastActivityAt?: Date | null;
  pendingWorkflowTaskAt?: Date | null;
  hasPendingActivity?: boolean;
}

export async function describeSubmissionJudge(
  submissionId: string,
  workflowId = `judge-${submissionId}`,
): Promise<SubmissionJudgeState | null> {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);
  try {
    const description = await handle.describe();
    const status = description.status.name;
    const timestamp = (
      value: { seconds?: unknown; nanos?: number | null } | null | undefined,
    ) =>
      value?.seconds !== undefined
        ? new Date(Number(value.seconds) * 1000 + (value.nanos ?? 0) / 1e6)
        : null;
    const activities = description.raw.pendingActivities ?? [];
    const times = activities.flatMap((activity) => {
      const time = timestamp(activity.lastHeartbeatTime ?? activity.lastStartedTime);
      return time ? [time.getTime()] : [];
    });
    return {
      status,
      running: status === "RUNNING",
      hasPendingActivity: activities.length > 0,
      lastActivityAt: times.length ? new Date(Math.max(...times)) : null,
      pendingWorkflowTaskAt:
        (description.raw.pendingWorkflowTask?.attempt ?? 0) > 1
          ? timestamp(description.raw.pendingWorkflowTask?.originalScheduledTime)
          : null,
    };
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return null;
    throw err;
  }
}

const SUBMISSION_SWEEPER_WORKFLOW_ID = "submission-pending-sweeper";

export async function ensureSubmissionSweeper(): Promise<void> {
  const client = await getTemporalClient();
  await startUnlessRunning(
    client.workflow.start("submissionSweeperWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: SUBMISSION_SWEEPER_WORKFLOW_ID,
      cronSchedule: "* * * * *",
      args: [],
    }),
  );
}

export const LIFECYCLE_RECONCILER_WORKFLOW_ID = "lifecycle-timer-reconciler";

export async function ensureLifecycleReconciler(): Promise<void> {
  const client = await getTemporalClient();
  await startUnlessRunning(
    client.workflow.start("lifecycleReconcilerProcessorWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: LIFECYCLE_RECONCILER_WORKFLOW_ID,
      cronSchedule: "*/5 * * * *",
      args: [],
    }),
  );
}

export const DURABLE_WORK_WORKFLOW_ID = "durable-work-processor";

export async function ensureDurableWorkProcessor(): Promise<void> {
  const client = await getTemporalClient();
  await startUnlessRunning(
    client.workflow.start("durableWorkProcessorWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: DURABLE_WORK_WORKFLOW_ID,
      cronSchedule: "* * * * *",
      args: [],
    }),
  );
}

const REGISTRY_GC_WORKFLOW_ID = "registry-gc";

export async function dispatchRegistryGarbageCollect(
  input: RegistryGarbageCollectInput,
): Promise<{ workflowId: string; alreadyRunning: boolean }> {
  const client = await getTemporalClient();
  const started = await startUnlessRunning(
    client.workflow.start("registryGarbageCollectWorkflow", {
      taskQueue: PLATFORM_TASK_QUEUE,
      workflowId: REGISTRY_GC_WORKFLOW_ID,
      memo: { triggeredByUserId: input.triggeredByUserId },
      args: [input],
    }),
  );
  return { workflowId: REGISTRY_GC_WORKFLOW_ID, alreadyRunning: !started };
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

    await startUnlessRunning(
      client.workflow.start(workflowType, {
        taskQueue: PLATFORM_TASK_QUEUE,
        workflowId,
        workflowIdConflictPolicy: "USE_EXISTING",
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
        memo: {
          scheduleRevision: input.scheduleRevision,
          timerFingerprint: input.timerFingerprint,
        },
        args: [input],
      }),
    );
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

export async function dispatchJudgeExecution(input: {
  executionId: string;
  workflowId: string;
  priority: JudgePriority;
}): Promise<void> {
  const client = await getTemporalClient();
  await startUnlessRunning(
    client.workflow.start("durableJudgeWorkflow", {
      workflowId: input.workflowId,
      taskQueue: JUDGE_TASK_QUEUE,
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      priority: input.priority,
      args: [{ executionId: input.executionId }],
    }),
  );
}

export async function dispatchJudgeCleanup(input: {
  executionId: string;
  workflowId: string;
  leaseToken: string;
}): Promise<void> {
  const client = await getTemporalClient();
  await startUnlessRunning(
    client.workflow.start("judgeCleanupWorkflow", {
      workflowId: `judge-cleanup-${input.leaseToken}`,
      workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
      taskQueue: JUDGE_TASK_QUEUE,
      args: [input],
    }),
  );
}
