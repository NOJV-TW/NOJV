import { randomUUID } from "node:crypto";
import {
  JUDGE_EXECUTION_DISPATCH_KIND,
  judgeExecutionStateSchema,
  type JudgeExecutionState,
  type JudgeExecutionView,
  type SandboxResult,
  type SubmissionResult,
} from "@nojv/core";
import {
  durableWorkRepo,
  Prisma,
  prismaAdapterClient as db,
  runTransaction,
  type TransactionClient,
} from "@nojv/db";
import {
  assertStorageObjectPointer,
  getVerifiedText,
  putImmutableObject,
  storagePointerFor,
  type StorageObjectPointer,
} from "@nojv/storage";
import { toJsonValue } from "../shared/to-json-value";
import { ConflictError } from "../shared/errors";
import { storage } from "../shared/storage-singleton";
import {
  commitStoragePointerSwap,
  guardStorageObjectWrites,
} from "../shared/storage-object-lifecycle";
import { dispatchNextJudgeExecutions } from "./judge-recovery";
import { readJudgeSnapshot } from "./judge-snapshot";
import { completeJudge, deriveVerdictSummary } from "./mutations";

export async function createJudgeExecution(
  tx: TransactionClient,
  input: {
    submissionId: string;
    pointer: StorageObjectPointer;
    problemGeneration: number;
    operationId?: string;
    triggeredByUserId?: string;
  },
) {
  const target = await tx.submission.findUniqueOrThrow({
    where: { id: input.submissionId },
    select: { problemId: true },
  });
  await tx.$queryRaw`SELECT id FROM "Problem" WHERE id = ${target.problemId} FOR UPDATE`;
  const problem = await tx.problem.findUniqueOrThrow({
    where: { id: target.problemId },
    select: { storageGeneration: true },
  });
  if (problem.storageGeneration !== input.problemGeneration)
    throw new ConflictError("Problem changed before judge acceptance. Please retry.");
  await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${input.submissionId} FOR UPDATE`;
  const submission = await tx.submission.findUniqueOrThrow({
    where: { id: input.submissionId },
  });
  const finalizing = await tx.judgeExecution.findFirst({
    where: { submissionId: submission.id, state: "finalizing" },
  });
  if (finalizing)
    throw new ConflictError(
      "The previous judge result is still being finalized. Please retry shortly.",
    );
  const id = randomUUID();
  const workflowId = `judge-execution-${id}-0`;
  const generation = submission.judgeGeneration + 1;
  await tx.judgeExecution.updateMany({
    where: { submissionId: submission.id, state: { notIn: ["completed", "cancelled"] } },
    data: { state: "cancelled" },
  });
  const log = input.triggeredByUserId
    ? await tx.submissionRejudgeLog.create({
        data: {
          submissionId: submission.id,
          rejudgeRunId: workflowId,
          rejudgedByUserId: input.triggeredByUserId,
          oldVerdict: submission.status,
          oldScore: submission.score,
          oldResultJson: submission.verdictSummary ?? Prisma.JsonNull,
        },
      })
    : null;
  const execution = await tx.judgeExecution.create({
    data: {
      id,
      submissionId: submission.id,
      generation,
      problemGeneration: input.problemGeneration,
      snapshot: input.pointer,
      workflowId,
      operationId: input.operationId ?? null,
      queueClass: input.operationId ? "background" : "foreground",
      oldStatus: submission.status,
      oldScore: submission.score,
      rejudgeLogId: log?.id ?? null,
    },
  });
  await tx.submission.update({
    where: { id: submission.id },
    data: {
      judgeGeneration: generation,
      activeJudgeRunId: workflowId,
      ...(input.triggeredByUserId ? {} : { status: "queued" }),
    },
  });
  await commitStoragePointerSwap(tx, { added: [input.pointer] });
  await durableWorkRepo.withTx(tx).enqueue({
    kind: JUDGE_EXECUTION_DISPATCH_KIND,
    dedupeKey: workflowId,
    payload: { executionId: id, workflowId },
    maxAttempts: 20,
  });
  return execution;
}

export async function loadJudgeExecution(executionId: string) {
  const execution = await db.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
  return { execution, snapshot: await readJudgeSnapshot(execution.snapshot) };
}

export async function setJudgeExecutionState(
  executionId: string,
  workflowId: string,
  state: JudgeExecutionState,
  reasonCode: string | null = null,
  lastError: string | null = null,
  delayMs = 0,
) {
  const now = new Date();
  return runTransaction(async (tx) => {
    const selected = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${selected.submissionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "JudgeExecution" WHERE id = ${executionId} FOR UPDATE`;
    const run = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (run.workflowId !== workflowId || ["completed", "cancelled"].includes(run.state))
      return false;
    const nextState =
      run.state === "finalizing" ? "finalizing" : judgeExecutionStateSchema.parse(state);
    await tx.judgeExecution.update({
      where: { id: executionId },
      data: {
        state: nextState,
        ...(nextState === "recovering" || nextState === "blocked"
          ? { queueClass: "background" }
          : {}),
        reasonCode,
        lastError: lastError?.slice(0, 2000) ?? null,
        nextAttemptAt: new Date(now.getTime() + delayMs),
        ...(nextState === "running" ? { lastProgressAt: now } : {}),
      },
    });
    if (!run.rejudgeLogId && nextState !== "finalizing")
      await tx.submission.updateMany({
        where: {
          id: run.submissionId,
          judgeGeneration: run.generation,
          activeJudgeRunId: workflowId,
        },
        data: {
          status:
            nextState === "blocked" || nextState === "recovering"
              ? "system_error"
              : nextState === "running"
                ? "running"
                : "queued",
        },
      });
    return true;
  });
}

export async function saveJudgeStage(
  executionId: string,
  workflowId: string,
  index: number,
  result: SandboxResult,
  leaseToken: string,
  terminal = false,
  retainLease = false,
) {
  const body = Buffer.from(JSON.stringify(result));
  const key = `judge-executions/${executionId}/stages/${String(index)}/${leaseToken}.json`;
  const pointer = storagePointerFor(key, body);
  await guardStorageObjectWrites([pointer]);
  await putImmutableObject(storage(), key, body, { contentType: "application/json" });
  return runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JudgeExecution" WHERE id = ${executionId} FOR UPDATE`;
    const run = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (
      run.workflowId !== workflowId ||
      run.leaseToken !== leaseToken ||
      run.state === "cancelled"
    )
      throw new ConflictError("Judge attempt no longer owns this execution.");
    const count = await tx.judgeStage.count({ where: { executionId } });
    if (index !== count) throw new ConflictError("Judge stage is not the next checkpoint.");
    await tx.judgeStage.create({ data: { executionId, index, result: pointer } });
    await commitStoragePointerSwap(tx, { added: [pointer] });
    await tx.judgeExecution.update({
      where: { id: executionId },
      data: {
        lastProgressAt: new Date(),
        queuedAt: new Date(),
        state: terminal ? "finalizing" : "queued",
        attempt: 0,
        ...(retainLease ? {} : { leaseToken: null, leaseUntil: null }),
        reasonCode: null,
        lastError: null,
      },
    });
  });
}

export async function readJudgeStages(executionId: string): Promise<SandboxResult[]> {
  const stages = await db.judgeStage.findMany({
    where: { executionId },
    orderBy: { index: "asc" },
  });
  return Promise.all(
    stages.map(
      async (stage) =>
        JSON.parse(
          await getVerifiedText(storage(), assertStorageObjectPointer(stage.result)),
        ) as SandboxResult,
    ),
  );
}

export async function completeJudgeExecution(
  executionId: string,
  workflowId: string,
  result: SubmissionResult,
) {
  const { execution, snapshot } = await loadJudgeExecution(executionId);
  if (execution.workflowId !== workflowId || execution.state === "cancelled") return null;
  if (result.verdict === "system_error")
    throw new Error("Judge returned system_error; execution must recover.");
  const persisted = await db.submission.findUniqueOrThrow({
    where: { id: execution.submissionId },
  });
  if (persisted.judgeGeneration !== execution.generation) return null;
  if (
    persisted.activeJudgeRunId === null &&
    persisted.verdictDetailStorage &&
    assertStorageObjectPointer(persisted.verdictDetailStorage).key.includes(
      `/judge-runs/judge-execution-${execution.id}-`,
    )
  ) {
    if (execution.rejudgeLogId)
      await db.submissionRejudgeLog.update({
        where: { id: execution.rejudgeLogId },
        data: {
          newVerdict: persisted.status,
          newScore: persisted.score,
          newResultJson: persisted.verdictSummary ?? Prisma.JsonNull,
        },
      });
    return {
      id: persisted.id,
      userId: persisted.userId,
      problemId: persisted.problemId,
      contestId: persisted.contestId,
      examId: persisted.examId,
      language: persisted.language,
      sampleOnly: persisted.sampleOnly,
      createdAt: persisted.createdAt,
      score: persisted.score,
      status: persisted.status,
    };
  }
  const advanced = snapshot.context.advanced;
  const submission = await completeJudge(
    execution.submissionId,
    workflowId,
    result,
    advanced
      ? {
          config: advanced.config,
          requiredPaths: advanced.requiredPaths,
          resourceLimits: advanced.resourceLimits,
        }
      : null,
  );
  if (submission && execution.rejudgeLogId) {
    await db.submissionRejudgeLog.update({
      where: { id: execution.rejudgeLogId },
      data: {
        newVerdict: submission.status,
        newScore: submission.score,
        newResultJson: toJsonValue(deriveVerdictSummary(result)),
      },
    });
  }
  return submission;
}

export async function finishJudgeExecution(executionId: string, workflowId: string) {
  await db.judgeExecution.updateMany({
    where: { id: executionId, workflowId, state: { not: "cancelled" } },
    data: {
      state: "completed",
      reasonCode: null,
      lastError: null,
      lastProgressAt: new Date(),
      leaseUntil: null,
      leaseToken: null,
    },
  });
  const run = await db.judgeExecution.findUnique({
    where: { id: executionId },
    select: { submission: { select: { userId: true } } },
  });
  if (run) await dispatchNextJudgeExecutions(run.submission.userId);
}

function executionView(run: {
  state: string;
  generation: number;
  problemGeneration: number;
  reasonCode: string | null;
  lastProgressAt: Date;
  nextAttemptAt: Date;
}): JudgeExecutionView {
  return {
    state: judgeExecutionStateSchema.parse(run.state),
    generation: run.generation,
    problemGeneration: run.problemGeneration,
    reasonCode:
      run.reasonCode === "capacity" || run.reasonCode === "SandboxBackpressureError"
        ? "capacity"
        : run.reasonCode === "cleanup_required" || run.reasonCode === "SandboxCleanupError"
          ? "cleanup_required"
          : run.reasonCode
            ? "system_failure"
            : null,
    lastProgressAt: run.lastProgressAt.toISOString(),
    nextRetryAt: ["completed", "cancelled"].includes(run.state)
      ? null
      : run.nextAttemptAt.toISOString(),
  };
}

export async function getJudgeExecutionViews(
  submissions: { id: string; judgeGeneration: number; status: string; updatedAt: Date }[],
): Promise<Map<string, JudgeExecutionView>> {
  if (!submissions.length) return new Map();
  const runs = await db.judgeExecution.findMany({
    where: {
      OR: submissions.map((row) => ({ submissionId: row.id, generation: row.judgeGeneration })),
    },
    select: {
      submissionId: true,
      state: true,
      generation: true,
      problemGeneration: true,
      reasonCode: true,
      lastProgressAt: true,
      nextAttemptAt: true,
    },
  });
  const byId = new Map(runs.map((run) => [run.submissionId, run]));
  const views = new Map<string, JudgeExecutionView>();
  for (const submission of submissions) {
    const run = byId.get(submission.id);
    if (run && run.generation >= submission.judgeGeneration) {
      views.set(submission.id, executionView(run));
    } else if (submission.status === "system_error") {
      views.set(submission.id, {
        state: "blocked",
        generation: submission.judgeGeneration,
        problemGeneration: null,
        reasonCode: "original_version_unavailable",
        lastProgressAt: submission.updatedAt.toISOString(),
        nextRetryAt: null,
      });
    }
  }
  return views;
}

export async function getJudgeExecutionView(
  submissionId: string,
): Promise<JudgeExecutionView | null> {
  const submission = await db.submission.findUnique({ where: { id: submissionId } });
  if (!submission) return null;
  return (await getJudgeExecutionViews([submission])).get(submissionId) ?? null;
}
