import { JUDGE_EXECUTION_DISPATCH_KIND, judgePriorityKey } from "@nojv/core";
import {
  DurableWorkInvariantError,
  durableWorkRepo,
  prismaAdapterClient as db,
  runTransaction,
} from "@nojv/db";
import { z } from "zod";
import { getDomainOrchestration } from "../shared/orchestration";

const dispatchSchema = z.object({
  executionId: z.uuid(),
  workflowId: z.string().min(1),
});

export async function executeJudgeExecutionDispatch(payload: unknown): Promise<void> {
  const input = dispatchSchema.parse(payload);
  const run = await db.judgeExecution.findUnique({
    where: { id: input.executionId },
    include: { submission: { select: { userId: true, examId: true, contestId: true } } },
  });
  if (run?.workflowId !== input.workflowId || ["cancelled", "completed"].includes(run.state))
    return;
  const blocker = await db.judgeExecution.findFirst({
    where: {
      submission: { userId: run.submission.userId },
      state: { notIn: ["cancelled", "completed"] },
      id: { not: run.id },
      OR: [
        ...(run.queueClass === "foreground" ? [] : [{ queueClass: "foreground" }]),
        { queueClass: run.queueClass, createdAt: { lt: run.createdAt } },
        { queueClass: run.queueClass, createdAt: run.createdAt, id: { lt: run.id } },
      ],
    },
    select: { id: true },
  });
  if (blocker) return;
  await getDomainOrchestration().dispatchJudgeExecution({
    executionId: run.id,
    workflowId: run.workflowId,
    priority: {
      priorityKey: judgePriorityKey({ ...run, ...run.submission }),
      fairnessKey: run.submission.userId,
    },
  });
}

async function enqueueJudgeDispatch(run: { id: string; workflowId: string }) {
  const work = {
    kind: JUDGE_EXECUTION_DISPATCH_KIND,
    dedupeKey: run.workflowId,
    payload: { executionId: run.id, workflowId: run.workflowId },
    maxAttempts: 20,
  };
  const existing = await db.durableWork.findUnique({
    where: { kind_dedupeKey: { kind: work.kind, dedupeKey: work.dedupeKey } },
  });
  if (!existing) await durableWorkRepo.enqueue(work);
  else if (["dead", "succeeded", "cancelled"].includes(existing.status))
    await durableWorkRepo.reactivate(work).catch((error: unknown) => {
      if (!(error instanceof DurableWorkInvariantError)) throw error;
    });
}

export async function dispatchNextJudgeExecutions(userId: string): Promise<void> {
  for (const queueClass of ["foreground", "background"]) {
    const next = await db.judgeExecution.findFirst({
      where: {
        queueClass,
        state: { notIn: ["cancelled", "completed"] },
        leaseToken: null,
        submission: { userId },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, workflowId: true },
    });
    if (next) await enqueueJudgeDispatch(next);
  }
}

export async function reconcileJudgeExecutions(now = new Date()): Promise<number> {
  const cleanup = await db.judgeExecution.findMany({
    where: {
      state: { in: ["completed", "cancelled"] },
      leaseToken: { not: null },
      leaseUntil: { lt: now },
    },
    take: 100,
  });
  for (const run of cleanup) {
    if (!run.leaseToken) continue;
    try {
      await getDomainOrchestration().dispatchJudgeCleanup({
        executionId: run.id,
        workflowId: run.workflowId,
        leaseToken: run.leaseToken,
      });
    } catch (error) {
      console.error("Judge cleanup dispatch failed", { executionId: run.id, error });
    }
  }
  const candidates = await db.judgeExecution.findMany({
    where: {
      state: { notIn: ["completed", "cancelled"] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  let recovered = 0;
  for (const run of candidates) {
    try {
      const state = await getDomainOrchestration().describeSubmissionJudge(
        run.submissionId,
        run.workflowId,
      );
      if (state?.running) {
        const stalledTask =
          state.pendingWorkflowTaskAt &&
          now.getTime() - state.pendingWorkflowTaskAt.getTime() > 600_000;
        const stalledActivity =
          state.lastActivityAt && now.getTime() - state.lastActivityAt.getTime() > 70 * 60_000;
        if (stalledTask || stalledActivity) {
          await db.judgeExecution.updateMany({
            where: { id: run.id, workflowId: run.workflowId },
            data: {
              reasonCode: "workflow_stalled",
              lastError: "Workflow exceeded its progress deadline.",
              nextAttemptAt: new Date(now.getTime() + 60_000),
            },
          });
          await getDomainOrchestration().terminateSubmissionJudge(
            run.submissionId,
            "Recovering a workflow with expired progress",
            run.workflowId,
          );
          continue;
        }
        await db.judgeExecution.updateMany({
          where: { id: run.id, workflowId: run.workflowId },
          data: { nextAttemptAt: new Date(now.getTime() + 60_000) },
        });
        continue;
      }
      if (!state) await enqueueJudgeDispatch(run);
      else {
        await runTransaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${run.submissionId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "JudgeExecution" WHERE id = ${run.id} FOR UPDATE`;
          const current = await tx.judgeExecution.findUniqueOrThrow({ where: { id: run.id } });
          if (
            current.workflowId !== run.workflowId ||
            ["completed", "cancelled"].includes(current.state)
          )
            return;
          const epoch = current.recoveryEpoch + 1;
          const workflowId = `judge-execution-${run.id}-${String(epoch)}`;
          await tx.judgeExecution.update({
            where: { id: run.id },
            data: {
              workflowId,
              recoveryEpoch: epoch,
              queueClass: "background",
              state: current.state === "finalizing" ? "finalizing" : "recovering",
              nextAttemptAt: new Date(now.getTime() + 60_000),
            },
          });
          await tx.submission.updateMany({
            where: {
              id: run.submissionId,
              judgeGeneration: run.generation,
              activeJudgeRunId: run.workflowId,
            },
            data: { activeJudgeRunId: workflowId },
          });
          if (run.rejudgeLogId)
            await tx.submissionRejudgeLog.update({
              where: { id: run.rejudgeLogId },
              data: { rejudgeRunId: workflowId },
            });
          await durableWorkRepo.withTx(tx).enqueue({
            kind: JUDGE_EXECUTION_DISPATCH_KIND,
            dedupeKey: workflowId,
            payload: { executionId: run.id, workflowId },
            maxAttempts: 20,
          });
        });
      }
      recovered++;
    } catch (error) {
      console.error("Judge execution reconciliation failed", { executionId: run.id, error });
    }
  }
  return recovered;
}

export async function kickJudgeExecution(submissionId: string): Promise<void> {
  const execution = await db.judgeExecution.findFirst({
    where: { submissionId },
    orderBy: { generation: "desc" },
  });
  if (execution)
    await executeJudgeExecutionDispatch({
      executionId: execution.id,
      workflowId: execution.workflowId,
    });
}
