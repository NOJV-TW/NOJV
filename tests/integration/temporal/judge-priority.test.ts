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
  it("schedules every stage with the priority and fairness key of its execution", async () => {
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
        return { status: "finished" as const };
      }),
      completePinnedJudge: vi.fn(async () => null),
      finishJudgeExecution: vi.fn(async (id: string) => {
        states.set(id, "completed");
      }),
      publishVerdict: vi.fn(async () => undefined),
    };
    const queue = `judge-priority-${Date.now()}`;
    const workflows = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: queue,
      workflowsPath,
      activities,
    });
    const state = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "judge-state",
      activities,
    });
    await state.runUntil(
      workflows.runUntil(async () => {
        const start = async (executionId: string, priorityKey: 1 | 5, fairnessKey: string) => ({
          handle: await env.client.workflow.start("durableJudgeWorkflow", {
            workflowId: `${queue}-${executionId}`,
            taskQueue: queue,
            priority: { priorityKey, fairnessKey },
            args: [{ executionId }],
          }),
          priorityKey,
          fairnessKey,
        });
        const handles = [
          await start("rejudge-a1", 5, "student-a"),
          await start("rejudge-a2", 5, "student-a"),
          await start("rejudge-b1", 5, "student-b"),
          await start("exam-c1", 1, "student-c"),
          await start("rejudge-b2", 5, "student-b"),
        ];
        await Promise.all(handles.map(({ handle }) => handle.result()));
        for (const { handle, priorityKey, fairnessKey } of handles) {
          const history = await handle.fetchHistory();
          const stage = history.events!.find(
            (event) =>
              event.activityTaskScheduledEventAttributes?.activityType?.name ===
              "executeJudgeStage",
          )!.activityTaskScheduledEventAttributes!;
          expect(stage.priority?.priorityKey, handle.workflowId).toBe(priorityKey);
          expect(stage.priority?.fairnessKey, handle.workflowId).toBe(fairnessKey);
        }
      }),
    );
    expect(new Set(started).size).toBe(5);
  }, 120_000);
});
