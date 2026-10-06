import { fileURLToPath } from "node:url";
import type { WorkflowStartOptions } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: { current: null as unknown } }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(async () => client.current),
}));

import {
  dispatchTestJudgeProgramBuild,
  runTestJudgeWorkflow,
} from "../../../packages/temporal/src/dispatch";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/test-judge.ts", import.meta.url),
);
const sha256 = "b".repeat(64);
let env: TestWorkflowEnvironment;
const testWorkflowIds: string[] = [];

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal({
    server: { executable: { type: "cached-download", version: "v1.7.2" } },
  });
  client.current = {
    workflow: {
      start: env.client.workflow.start.bind(env.client.workflow),
      execute: (workflowType: string, options: WorkflowStartOptions) => {
        testWorkflowIds.push(options.workflowId);
        return env.client.workflow.execute(workflowType, options);
      },
    },
  };
}, 180_000);

afterAll(async () => {
  await env?.teardown();
});

async function scheduledPriority(workflowId: string): Promise<number | null | undefined> {
  const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
  return history.events!.find((event) => event.activityTaskScheduledEventAttributes)!
    .activityTaskScheduledEventAttributes!.priority?.priorityKey;
}

describe("test-judge queue priority", () => {
  it("schedules Test activities at a higher priority than judge program builds", async () => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: "test-judge",
      workflowsPath,
      activities: {
        runTestJudge: vi.fn(async () => ({ ok: true, cases: [] })),
        buildTestJudgeProgram: vi.fn(async () => undefined),
      },
    });

    await worker.runUntil(async () => {
      await dispatchTestJudgeProgramBuild({
        role: "checker",
        language: "cpp",
        scriptPointer: { key: `judge-scripts/${sha256}`, sha256, size: 12 },
      });
      const buildId = `test-judge-build-checker-cpp-${sha256}`;
      await env.client.workflow.getHandle(buildId).result();
      await expect(
        runTestJudgeWorkflow(
          { requestKey: "test-judge-requests/a.json" },
          { timeoutMs: 30_000 },
        ),
      ).resolves.toEqual({ ok: true, cases: [] });

      expect(await scheduledPriority(testWorkflowIds[0]!)).toBe(1);
      expect(await scheduledPriority(buildId)).toBe(5);
    });
  }, 120_000);
});
