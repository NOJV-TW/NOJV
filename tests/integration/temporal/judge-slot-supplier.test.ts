import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { NodeLoadSlotSupplier } from "../../../apps/worker/src/judge-slot-supplier";

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

describe("node-load judge slots on a Temporal worker", () => {
  it("runs no more stages than the budget and starts more as the budget grows", async () => {
    let running = 0;
    let open = false;
    const release: (() => void)[] = [];
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
      executeJudgeStage: vi.fn(async () => {
        running += 1;
        if (!open) await new Promise<void>((resolve) => release.push(resolve));
        running -= 1;
        return { status: "finished" as const };
      }),
      completePinnedJudge: vi.fn(async () => null),
      finishJudgeExecution: vi.fn(async (id: string) => {
        states.set(id, "completed");
      }),
      publishVerdict: vi.fn(async () => undefined),
    };
    const supplier = new NodeLoadSlotSupplier(1, 3);
    const idle = { cpu: 0.1, memoryAvailable: 0.9 };
    const queue = `judge-slots-${Date.now()}`;
    const workflows = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: queue,
      workflowsPath,
      activities,
      tuner: {
        workflowTaskSlotSupplier: { type: "fixed-size", numSlots: 8 },
        activityTaskSlotSupplier: supplier,
        localActivityTaskSlotSupplier: { type: "fixed-size", numSlots: 10 },
        nexusTaskSlotSupplier: { type: "fixed-size", numSlots: 10 },
      },
    });
    const state = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "judge-state",
      activities,
    });
    await state.runUntil(
      workflows.runUntil(async () => {
        const handles = await Promise.all(
          ["a", "b", "c", "d"].map((id) =>
            env.client.workflow.start("durableJudgeWorkflow", {
              workflowId: `${queue}-${id}`,
              taskQueue: queue,
              args: [{ executionId: `${queue}-${id}` }],
            }),
          ),
        );
        await vi.waitFor(() => expect(running).toBe(1), { timeout: 15_000 });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(running).toBe(1);
        supplier.adjust(idle);
        await vi.waitFor(() => expect(running).toBe(2), { timeout: 15_000 });
        supplier.adjust(idle);
        supplier.adjust(idle);
        await vi.waitFor(() => expect(running).toBe(3), { timeout: 15_000 });
        supplier.adjust(idle);
        supplier.adjust(idle);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        expect(running).toBe(3);
        expect(supplier.budget).toBe(3);
        open = true;
        release.splice(0).forEach((resolve) => resolve());
        await Promise.all(handles.map((handle) => handle.result()));
      }),
    );
    expect(activities.executeJudgeStage).toHaveBeenCalledTimes(4);
    expect(supplier.used).toBe(0);
  }, 120_000);
});
