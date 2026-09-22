import { randomUUID } from "node:crypto";
import { prismaAdapterClient as db, runTransaction } from "@nojv/db";

export async function claimJudgeLease(executionId: string, workflowId: string, owner: string) {
  return runTransaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JudgeExecution" WHERE id = ${executionId} FOR UPDATE`;
    const current = await tx.judgeExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (current.workflowId !== workflowId || ["cancelled", "completed"].includes(current.state))
      return { status: "obsolete" as const };
    if (current.leaseToken)
      return { status: "cleanup" as const, leaseToken: current.leaseToken };
    const leaseToken = randomUUID();
    await tx.judgeExecution.update({
      where: { id: executionId },
      data: {
        state: "running",
        leaseToken,
        leaseOwner: owner,
        leaseUntil: new Date(Date.now() + 120_000),
        attempt: { increment: 1 },
        lastProgressAt: new Date(),
      },
    });
    return { status: "claimed" as const, leaseToken };
  });
}

export async function heartbeatJudgeStage(
  executionId: string,
  workflowId: string,
  leaseToken: string,
  owner?: string,
) {
  const changed = await db.judgeExecution.updateMany({
    where: { id: executionId, workflowId, leaseToken, state: { not: "cancelled" } },
    data: {
      leaseUntil: new Date(Date.now() + 120_000),
      ...(owner ? { leaseOwner: owner } : {}),
    },
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
