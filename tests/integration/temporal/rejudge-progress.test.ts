import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { ApplicationFailure } from "@temporalio/activity";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { getTemporalClient } = vi.hoisted(() => ({ getTemporalClient: vi.fn() }));
vi.mock("../../../packages/temporal/src/client", () => ({ getTemporalClient }));

import { cancelRejudge, queryRejudgeProgress } from "../../../packages/temporal/src/dispatch";

const workflowsPath = fileURLToPath(
  new URL("../../../apps/worker/src/workflows/index.ts", import.meta.url),
);
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  getTemporalClient.mockResolvedValue(env.client);
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

async function runRejudge(
  snapshotSubmissionForRejudge: () => Promise<null>,
  body: (workflowId: string, handle: WorkflowHandle) => Promise<void>,
) {
  const taskQueue = "rejudge-progress-test";
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    activities: {
      fetchSingleSubmissionForRejudge: async (submissionId: string) => ({
        submissionId,
        draft: { problemId: "prob_1", language: "python", sourceCode: "print(1)" },
      }),
      snapshotSubmissionForRejudge,
    },
  });
  await worker.runUntil(async () => {
    const workflowId = `rejudge-progress-${randomUUID()}`;
    const handle = await env.client.workflow.start("rejudgeWorkflow", {
      taskQueue,
      workflowId,
      args: [{ mode: "single", submissionId: workflowId, triggeredByUserId: "requester" }],
    });
    await body(workflowId, handle);
  });
}

describe("rejudge progress against Temporal", () => {
  it.each(["completed", "failed"] as const)(
    "queries the real %s workflow after it closes",
    async (status) => {
      await runRejudge(
        async () => {
          if (status === "failed") throw ApplicationFailure.nonRetryable("snapshot failed");
          return null;
        },
        async (workflowId, handle) => {
          if (status === "completed") await handle.result();
          else await expect(handle.result()).rejects.toThrow();
          await expect(queryRejudgeProgress(workflowId)).resolves.toEqual({
            status,
            completed: status === "completed" ? 1 : 0,
            total: 1,
          });
        },
      );
    },
    30_000,
  );

  it("queries running progress and confirmed cancellation after the child closes", async () => {
    let markStarted: () => void = () => undefined;
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pending = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    await runRejudge(
      () => {
        markStarted();
        return pending;
      },
      async (workflowId, handle) => {
        try {
          await started;
          await expect(queryRejudgeProgress(workflowId)).resolves.toEqual({
            status: "running",
            completed: 0,
            total: 1,
          });
          await cancelRejudge(workflowId);
          await expect(handle.result()).rejects.toThrow();
          await expect(queryRejudgeProgress(workflowId)).resolves.toEqual({
            status: "cancelled",
            completed: 0,
            total: 1,
          });
        } finally {
          release();
        }
      },
    );
  }, 30_000);
});

it("exposes the captured batch target generations only after selection finishes", async () => {
  let markSelecting!: () => void;
  let releaseSelection!: () => void;
  let markChild!: () => void;
  let releaseChild!: () => void;
  const selecting = new Promise<void>((resolve) => {
    markSelecting = resolve;
  });
  const selection = new Promise<void>((resolve) => {
    releaseSelection = resolve;
  });
  const childStarted = new Promise<void>((resolve) => {
    markChild = resolve;
  });
  const child = new Promise<null>((resolve) => {
    releaseChild = () => resolve(null);
  });
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: "rejudge-batch-targets",
    workflowsPath,
    activities: {
      fetchSubmissionIdsForRejudge: async () => {
        markSelecting();
        await selection;
        return [
          {
            submissionId: "selected",
            judgeGeneration: 3,
            draft: { problemId: "problem", language: "python" },
          },
        ];
      },
      snapshotSubmissionForRejudge: () => {
        markChild();
        return child;
      },
    },
  });
  await worker.runUntil(async () => {
    const workflowId = `rejudge-targets-${randomUUID()}`;
    const handle = await env.client.workflow.start("rejudgeWorkflow", {
      taskQueue: "rejudge-batch-targets",
      workflowId,
      args: [{ mode: "batch", problemId: "problem", triggeredByUserId: "staff" }],
    });
    try {
      await selecting;
      expect(await queryRejudgeProgress(workflowId)).toMatchObject({
        status: "running",
        targets: null,
      });
      releaseSelection();
      await childStarted;
      expect(await queryRejudgeProgress(workflowId)).toMatchObject({
        status: "running",
        targets: [{ submissionId: "selected", judgeGeneration: 3 }],
      });
      releaseChild();
      await handle.result();
      expect(await queryRejudgeProgress(workflowId)).toMatchObject({
        status: "completed",
        targets: [{ submissionId: "selected", judgeGeneration: 3 }],
      });
    } finally {
      releaseSelection();
      releaseChild();
    }
  });
}, 30_000);
