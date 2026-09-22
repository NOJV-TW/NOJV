import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({ workflow: { start } }),
}));

import {
  DURABLE_WORK_WORKFLOW_ID,
  ensureDurableWorkProcessor,
  ensureLifecycleReconciler,
  LIFECYCLE_RECONCILER_WORKFLOW_ID,
} from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDurableWorkProcessor", () => {
  it("starts one minute-cron platform processor", async () => {
    start.mockResolvedValue(undefined);

    await ensureDurableWorkProcessor();

    expect(start).toHaveBeenCalledWith("durableWorkProcessorWorkflow", {
      taskQueue: "platform",
      workflowId: DURABLE_WORK_WORKFLOW_ID,
      cronSchedule: "* * * * *",
      args: [],
    });
  });

  it("is idempotent when the fixed workflow already exists", async () => {
    start.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        DURABLE_WORK_WORKFLOW_ID,
        "durableWorkProcessorWorkflow",
      ),
    );

    await expect(ensureDurableWorkProcessor()).resolves.toBeUndefined();
  });
});

describe("ensureLifecycleReconciler", () => {
  it("starts the five-minute cron parent on the existing singleton identity", async () => {
    start.mockResolvedValue(undefined);
    await ensureLifecycleReconciler();
    expect(start).toHaveBeenCalledWith("lifecycleReconcilerProcessorWorkflow", {
      taskQueue: "platform",
      workflowId: LIFECYCLE_RECONCILER_WORKFLOW_ID,
      cronSchedule: "*/5 * * * *",
      args: [],
    });
  });

  it("preserves a running former singleton for an explicit operator handoff", async () => {
    start.mockRejectedValue(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        LIFECYCLE_RECONCILER_WORKFLOW_ID,
        "lifecycleReconcilerWorkflow",
      ),
    );
    await expect(ensureLifecycleReconciler()).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledOnce();
  });
});
