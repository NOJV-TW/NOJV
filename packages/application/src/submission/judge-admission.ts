import { randomUUID } from "node:crypto";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";
import { getDomainOrchestration } from "../shared/orchestration";

export async function claimJudgeStage(
  executionId: string,
  workflowId: string,
  slots: number,
  owner: string,
) {
  return runTransaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "JudgeAdmission" (id, cursor) VALUES ('sandbox', 0) ON CONFLICT (id) DO NOTHING`;
    await tx.$queryRaw`SELECT id FROM "JudgeAdmission" WHERE id = 'sandbox' FOR UPDATE`;
    const current = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (current.workflowId !== workflowId || ["cancelled", "completed"].includes(current.state))
      return { status: "obsolete" as const };
    if (current.leaseToken)
      return { status: "cleanup" as const, leaseToken: current.leaseToken };
    const active = await tx.judgeExecution.count({ where: { leaseToken: { not: null } } });
    if (active >= slots) return { status: "wait" as const };
    const admission = await tx.judgeAdmission.findUniqueOrThrow({ where: { id: "sandbox" } });
    const preferred = admission.cursor % 5 === 4 ? "background" : "foreground";
    const eligible = {
      state: { in: ["queued", "waiting_capacity", "recovering"] },
      leaseToken: null,
      nextAttemptAt: { lte: new Date() },
    };
    const orderBy = [{ queuedAt: "asc" as const }, { id: "asc" as const }];
    const chosen =
      (await tx.judgeExecution.findFirst({
        where: { ...eligible, queueClass: preferred },
        orderBy,
      })) ?? (await tx.judgeExecution.findFirst({ where: eligible, orderBy }));
    if (chosen?.id !== executionId) return { status: "wait" as const };
    const leaseToken = randomUUID();
    const claimed = await tx.judgeExecution.updateMany({
      where: { ...eligible, id: executionId, workflowId, queueClass: chosen.queueClass },
      data: {
        state: "running",
        leaseToken,
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + 120_000),
        attempt: { increment: 1 },
        lastProgressAt: new Date(),
      },
    });
    if (claimed.count !== 1) return { status: "obsolete" as const };
    await tx.judgeAdmission.update({
      where: { id: "sandbox" },
      data: { cursor: (admission.cursor + 1) % 5 },
    });
    return { status: "claimed" as const, leaseToken };
  });
}

export async function heartbeatJudgeStage(
  executionId: string,
  workflowId: string,
  leaseToken: string,
) {
  const changed = await db.judgeExecution.updateMany({
    where: { id: executionId, workflowId, leaseToken, state: { not: "cancelled" } },
    data: { leaseUntil: new Date(Date.now() + 120_000) },
  });
  return changed.count === 1;
}

export async function releaseJudgeStage(
  executionId: string,
  workflowId: string,
  leaseToken: string,
) {
  await db.judgeExecution.updateMany({
    where: { id: executionId, workflowId, leaseToken },
    data: { leaseToken: null, leaseUntil: null, queuedAt: new Date() },
  });
}

export async function wakeJudgeAdmission(): Promise<void> {
  const heads = await Promise.all(
    ["foreground", "background"].map((queueClass) =>
      db.judgeExecution.findFirst({
        where: {
          queueClass,
          state: { in: ["queued", "waiting_capacity", "recovering"] },
          leaseToken: null,
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
        select: { id: true, workflowId: true },
      }),
    ),
  );
  await Promise.allSettled(
    heads
      .filter((run) => run !== null)
      .map(async (run) =>
        getDomainOrchestration().dispatchJudgeExecution({
          executionId: run.id,
          workflowId: run.workflowId,
        }),
      ),
  );
}
