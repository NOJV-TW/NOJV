import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/activity";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/durable-judge.ts", import.meta.url),
);
let env: TestWorkflowEnvironment;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);
afterAll(async () => {
  await env?.teardown();
});

async function scenario(options: {
  capacity?: number;
  outage?: number;
  finalize?: number;
  wait?: number;
}) {
  let state = "queued";
  let attempts = 0;
  let finalizations = 0;
  const phases: string[] = [];
  const activities = {
    judgeExecutionStatus: vi.fn(async (_id: string, _owner: string) => ({
      state,
      stage: 0,
      leaseToken: null,
      attempt: attempts,
    })),
    setJudgeExecutionState: vi.fn(async (_id: string, _owner: string, next: string) => {
      state = next;
      phases.push(next);
      return true;
    }),
    executeJudgeStage: vi.fn(async () => {
      attempts++;
      if (attempts <= (options.capacity ?? 0))
        throw ApplicationFailure.create({ type: "SandboxBackpressureError", message: "quota" });
      if (attempts <= (options.outage ?? 0))
        throw ApplicationFailure.create({
          type: "SandboxTransientInfrastructureError",
          message: "node lost",
        });
      if (attempts <= (options.wait ?? 0)) return { status: "cleanup" };
      return { status: "finished" };
    }),
    completePinnedJudge: vi.fn(async () => {
      finalizations++;
      if (finalizations <= (options.finalize ?? 0))
        throw ApplicationFailure.create({
          type: "InvalidStage",
          message: "storage unavailable",
          nonRetryable: true,
        });
      return {
        id: "sub",
        userId: "user",
        contestId: null,
        examId: null,
        status: "accepted",
        score: 100,
      };
    }),
    finishJudgeExecution: vi.fn(async () => {
      state = "completed";
    }),
    publishVerdict: vi.fn(async () => undefined),
  };
  const queue = `durable-judge-${Date.now()}-${Math.random()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: queue,
    workflowsPath,
    activities,
  });
  const platform = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "platform",
    workflowsPath,
    activities,
  });
  let id = "";
  await worker.runUntil(
    platform.runUntil(async () => {
      const handle = await env.client.workflow.start("durableJudgeWorkflow", {
        workflowId: queue,
        taskQueue: queue,
        args: [{ executionId: "immutable-original-version" }],
      });
      id = handle.workflowId;
      await handle.result();
    }),
  );
  return { activities, phases, id };
}

describe("durable judge recovery workflow", () => {
  it("waits beyond the old retry budget without marking capacity as SE", async () => {
    const { activities, phases } = await scenario({ capacity: 5 });
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(6);
    expect(phases).not.toContain("recovering");
    expect(phases).not.toContain("blocked");
    expect(activities.publishVerdict).toHaveBeenCalledOnce();
  }, 30_000);
  it("recovers repeated machine failures without starting teacher rejudge", async () => {
    const { activities, phases } = await scenario({ outage: 4 });
    expect(phases).toContain("recovering");
    expect(phases).toContain("blocked");
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(5);
    for (const call of activities.judgeExecutionStatus.mock.calls)
      expect(call[0]).toBe("immutable-original-version");
    expect(activities.finishJudgeExecution).toHaveBeenCalledOnce();
  }, 30_000);
  it("retries finalization without running the sandbox again", async () => {
    const { activities } = await scenario({ finalize: 4 });
    expect(activities.executeJudgeStage).toHaveBeenCalledOnce();
    expect(activities.completePinnedJudge).toHaveBeenCalledTimes(5);
    expect(activities.publishVerdict).toHaveBeenCalledOnce();
  }, 30_000);
  it("continues as new during long cleanup waits with only an execution reference", async () => {
    const { activities, id } = await scenario({ wait: 105 });
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(106);
    const history = await env.client.workflow.getHandle(id).fetchHistory();
    expect(JSON.stringify(history).length).toBeLessThan(1_000_000);
    expect(activities.finishJudgeExecution).toHaveBeenCalledOnce();
  }, 60_000);
});
