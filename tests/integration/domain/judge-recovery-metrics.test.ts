import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prismaAdapterClient as db } from "@nojv/db";
import { readJudgeRecoverySnapshot } from "../../../apps/worker/src/judge-recovery-metrics";
import {
  createTestProblem,
  createTestSubmission,
  createTestUser,
} from "../../fixtures/factories";

describe("Judge recovery metrics (real SQL)", () => {
  it("emits zero counts and a fresh heartbeat for an empty queue", async () => {
    const snapshot = await readJudgeRecoverySnapshot();
    expect(snapshot).toMatchObject({
      queueDepth: 0,
      oldestQueueSeconds: 0,
      blocked: 0,
      stalled: 0,
      legacySystemErrors: 0,
    });
    expect(Math.abs(snapshot.observedAt - Date.now() / 1000)).toBeLessThan(10);
  });

  it("detects queue backlog, expired execution progress and legacy SE without flagging a healthy long-running stage", async () => {
    const teacher = await createTestUser({ platformRole: "teacher" });
    const user = await createTestUser();
    const problem = await createTestProblem({ authorId: teacher.id });
    const now = Date.now();
    const before = (minutes: number) => new Date(now - minutes * 60000);
    const add = async (state: string, age: number, leaseUntil?: Date) => {
      const submission = await createTestSubmission({
        userId: user.id,
        problemId: problem.id,
        status: "queued",
      });
      await db.judgeExecution.create({
        data: {
          id: randomUUID(),
          submissionId: submission.id,
          generation: 1,
          problemGeneration: 1,
          snapshot: {},
          workflowId: randomUUID(),
          oldStatus: "queued",
          oldScore: 0,
          state,
          createdAt: before(age),
          queuedAt: before(age),
          lastProgressAt: before(age),
          nextAttemptAt: before(1),
          ...(leaseUntil ? { leaseUntil } : {}),
        },
      });
    };
    await add("waiting_capacity", 15);
    await add("running", 50, new Date(now + 300000));
    await add("running", 20, before(1));
    await add("blocked", 25);
    await add("completed", 50);
    await add("cancelled", 50);
    await createTestSubmission({
      userId: user.id,
      problemId: problem.id,
      status: "system_error",
    });
    const snapshot = await readJudgeRecoverySnapshot();
    expect(snapshot).toMatchObject({
      queueDepth: 1,
      blocked: 1,
      stalled: 2,
      legacySystemErrors: 1,
    });
    expect(snapshot.oldestQueueSeconds).toBeGreaterThanOrEqual(899);
    expect(snapshot.oldestQueueSeconds).toBeLessThan(920);
  });
});
