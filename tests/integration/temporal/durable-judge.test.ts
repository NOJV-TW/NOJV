import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { ApplicationFailure, Context } from "@temporalio/activity";
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
  lost?: number;
  outage?: number;
  finalize?: number;
  wait?: number;
  deferredCleanup?: boolean;
  cleanupFails?: number;
  stages?: number;
}) {
  let state = "queued";
  let attempts = 0;
  let finalizations = 0;
  let cleanupAttempts = 0;
  let lease: string | null = null;
  let stage = 0;
  const totalStages = options.stages ?? 1;
  const phases: string[] = [];
  const order: string[] = [];
  let releaseCleanup: () => void = () => undefined;
  const verdictPublished = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const activities = {
    judgeExecutionStatus: vi.fn(async (_id: string, _owner: string) => ({
      state,
      stage,
      leaseToken: lease,
      attempt: attempts,
    })),
    setJudgeExecutionState: vi.fn(async (_id: string, _owner: string, next: string) => {
      state = next;
      phases.push(next);
      return true;
    }),
    executeJudgeStage: vi.fn(async (..._args: unknown[]) => {
      attempts++;
      order.push(`execute-${String(stage)}`);
      if (attempts <= (options.capacity ?? 0))
        throw ApplicationFailure.create({ type: "SandboxBackpressureError", message: "quota" });
      if (attempts <= (options.lost ?? 0)) {
        await env.sleep("61s");
        await Context.current().sleep("2h");
      }
      if (attempts <= (options.outage ?? 0))
        throw ApplicationFailure.create({
          type: "SandboxTransientInfrastructureError",
          message: "node lost",
        });
      if (attempts <= (options.wait ?? 0)) return { status: "cleanup" };
      const index = stage;
      const status = index + 1 >= totalStages ? "finished" : "saved";
      stage = index + 1;
      if (status === "finished") state = "finalizing";
      if (options.deferredCleanup) lease = "lease";
      return options.deferredCleanup
        ? {
            status,
            cleanup: {
              jobName: `judge-stage-${String(index)}`,
              namespace: "nojv-sandbox",
              payloadNames: [],
              deadlineSeconds: 60,
              mode: "standard",
              language: "c",
              leaseToken: "lease",
            },
          }
        : { status };
    }),
    cleanupJudgeStage: vi.fn(
      async (_id: string, _owner: string, cleanup: { jobName: string }) => {
        cleanupAttempts++;
        order.push("cleanup-started");
        if (cleanupAttempts <= (options.cleanupFails ?? 0))
          throw ApplicationFailure.create({
            type: "SandboxCleanupError",
            message: "delete denied",
            nonRetryable: true,
          });
        if (cleanup.jobName === `judge-stage-${String(totalStages - 1)}`)
          await verdictPublished;
        lease = null;
        order.push("cleanup-finished");
      },
    ),
    reconcileJudgeStage: vi.fn(async () => {
      order.push("reconcile");
      lease = null;
      return true;
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
      order.push("finished");
      state = "completed";
    }),
    publishVerdict: vi.fn(async () => {
      order.push("published");
      releaseCleanup();
    }),
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
  const stateWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-state",
    activities,
  });
  const cleanupWorker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "judge-cleanup",
    activities,
  });
  let id = "";
  await worker.runUntil(
    platform.runUntil(
      stateWorker.runUntil(
        cleanupWorker.runUntil(async () => {
          const handle = await env.client.workflow.start("durableJudgeWorkflow", {
            workflowId: queue,
            taskQueue: queue,
            args: [{ executionId: "immutable-original-version" }],
          });
          id = handle.workflowId;
          await handle.result();
        }),
      ),
    ),
  );
  return { activities, phases, id, order };
}

describe("durable judge recovery workflow", () => {
  it("waits beyond the old retry budget without marking capacity as SE", async () => {
    const { activities, phases } = await scenario({ capacity: 5 });
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(6);
    expect(phases).not.toContain("recovering");
    expect(phases).not.toContain("blocked");
    expect(phases).not.toContain("finalizing");
    expect(activities.publishVerdict).toHaveBeenCalledOnce();
  }, 30_000);
  it("requeues a stage attempt that never started without marking it SE", async () => {
    const { activities, phases } = await scenario({ lost: 1 });
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(2);
    expect(phases).not.toContain("recovering");
    expect(phases).not.toContain("blocked");
    expect(activities.publishVerdict).toHaveBeenCalledOnce();
  }, 30_000);
  it("replays a pre-fix history that recorded an unstarted stage as recovering", async () => {
    const history = JSON.parse(
      await readFile(
        new URL(
          "../../fixtures/temporal/durable-judge-pre-unstarted-requeue.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await expect(Worker.runReplayHistory({ workflowsPath }, history)).resolves.toBeUndefined();
  }, 15_000);
  it("replays a pre-fix history that set finalizing after the terminal stage", async () => {
    const history = JSON.parse(
      await readFile(
        new URL(
          "../../fixtures/temporal/durable-judge-pre-finalizing-dedupe.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await expect(Worker.runReplayHistory({ workflowsPath }, history)).resolves.toBeUndefined();
  }, 15_000);
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
  it("publishes the verdict while the deferred stage cleanup is still running", async () => {
    const { activities, order } = await scenario({ deferredCleanup: true });
    expect(activities.executeJudgeStage.mock.calls[0]?.[3]).toBe(true);
    expect(activities.cleanupJudgeStage).toHaveBeenCalledOnce();
    expect(order).toEqual([
      "execute-0",
      "cleanup-started",
      "published",
      "cleanup-finished",
      "finished",
    ]);
  }, 30_000);
  it("reconciles a failed deferred cleanup's lease without publishing the verdict again", async () => {
    const { activities, phases, order } = await scenario({
      deferredCleanup: true,
      cleanupFails: 1,
    });
    expect(phases).toContain("finalizing");
    expect(activities.reconcileJudgeStage).toHaveBeenCalledOnce();
    expect(order.indexOf("reconcile")).toBeLessThan(order.indexOf("finished"));
    expect(activities.completePinnedJudge).toHaveBeenCalledOnce();
    expect(activities.publishVerdict).toHaveBeenCalledOnce();
    expect(activities.finishJudgeExecution).toHaveBeenCalledOnce();
  }, 30_000);
  it("finishes a stage's deferred cleanup before the next stage starts", async () => {
    const { activities, order } = await scenario({ deferredCleanup: true, stages: 2 });
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(2);
    expect(activities.cleanupJudgeStage).toHaveBeenCalledTimes(2);
    expect(order.indexOf("cleanup-finished")).toBeLessThan(order.indexOf("execute-1"));
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
