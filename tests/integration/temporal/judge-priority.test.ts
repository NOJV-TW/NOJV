import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/durable-judge.ts", import.meta.url),
);
let env: TestWorkflowEnvironment;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal({
    server: { executable: { type: "cached-download", version: "v1.7.2" } },
  });
}, 180_000);
afterAll(async () => {
  await env?.teardown();
});

describe("judge task queue priority", () => {
  it("starts an exam submission ahead of queued rejudges on a saturated worker", async () => {
    const started: string[] = [];
    const states = new Map<string, string>();
    const activities = {
      judgeExecutionStatus: vi.fn(async (id: string) => ({
        state: states.get(id) ?? "queued",
        stage: 0,
        leaseToken: null,
        reasonCode: null,
        attempt: 0,
      })),
      setJudgeExecutionState: vi.fn(async (id: string, _owner: string, next: string) => {
        states.set(id, next);
        return true;
      }),
      executeJudgeStage: vi.fn(async (id: string) => {
        started.push(id);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { status: "finished" as const };
      }),
      completePinnedJudge: vi.fn(async () => null),
      finishJudgeExecution: vi.fn(async (id: string) => {
        states.set(id, "completed");
      }),
      publishVerdict: vi.fn(async () => undefined),
    };
    const queue = `judge-priority-${Date.now()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: queue,
      workflowsPath,
      activities,
      maxConcurrentActivityTaskExecutions: 1,
      maxConcurrentActivityTaskPolls: 1,
    });
    await worker.runUntil(async () => {
      const start = (executionId: string, priorityKey: 1 | 5, fairnessKey: string) =>
        env.client.workflow.start("durableJudgeWorkflow", {
          workflowId: `${queue}-${executionId}`,
          taskQueue: queue,
          priority: { priorityKey, fairnessKey },
          args: [{ executionId }],
        });
      const handles = [
        await start("rejudge-a1", 5, "student-a"),
        await start("rejudge-a2", 5, "student-a"),
        await start("rejudge-b1", 5, "student-b"),
        await start("exam-c1", 1, "student-c"),
        await start("rejudge-b2", 5, "student-b"),
      ];
      await Promise.all(handles.map((handle) => handle.result()));
    });
    const examAt = started.indexOf("exam-c1");
    expect(examAt).toBeLessThanOrEqual(1);
    for (const id of started.filter((entry, index) => index !== 0 && entry !== "exam-c1"))
      expect(examAt).toBeLessThan(started.indexOf(id));
    expect(new Set(started).size).toBe(5);
  }, 120_000);
});
