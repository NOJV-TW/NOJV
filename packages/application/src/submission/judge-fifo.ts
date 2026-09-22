import { Prisma, prismaAdapterClient as db } from "@nojv/db";

export async function resolveJudgeFifoWaiters(
  waiters: readonly { executionId: string; workflowId: string }[],
) {
  if (waiters.length === 0) return [];
  const ids = [...new Set(waiters.map((waiter) => waiter.executionId))];
  const rows = await db.$queryRaw<
    { id: string; workflowId: string; state: string; ready: boolean }[]
  >(Prisma.sql`
    WITH requested AS (
      SELECT e.id, e."workflowId", e.state, s."userId"
      FROM "JudgeExecution" e
      JOIN "Submission" s ON s.id = e."submissionId"
      WHERE e.id IN (${Prisma.join(ids)})
    ), heads AS (
      SELECT DISTINCT ON (s."userId") s."userId", e.id
      FROM "JudgeExecution" e
      JOIN "Submission" s ON s.id = e."submissionId"
      WHERE e.state NOT IN ('completed', 'cancelled')
        AND s."userId" IN (SELECT "userId" FROM requested)
      ORDER BY s."userId", e."createdAt", e.id
    )
    SELECT r.id, r."workflowId", r.state, COALESCE(r.id = h.id, false) AS ready
    FROM requested r LEFT JOIN heads h ON h."userId" = r."userId"
  `);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return waiters.flatMap<{
    executionId: string;
    workflowId: string;
    outcome: "ready" | "obsolete";
  }>((waiter) => {
    const row = byId.get(waiter.executionId);
    if (
      row?.workflowId !== waiter.workflowId ||
      row.state === "cancelled" ||
      row.state === "completed"
    )
      return [{ ...waiter, outcome: "obsolete" as const }];
    return row.ready ? [{ ...waiter, outcome: "ready" as const }] : [];
  });
}
