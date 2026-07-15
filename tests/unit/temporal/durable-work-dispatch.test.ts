import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn().mockResolvedValue({ workflow: { start } }),
}));

import {
  DURABLE_WORK_WORKFLOW_ID,
  ensureDurableWorkProcessor,
} from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDurableWorkProcessor", () => {
  it("starts one minute-cron platform processor", async () => {
    start.mockResolvedValue(undefined);

    await ensureDurableWorkProcessor();

    expect(start).toHaveBeenCalledWith("durableWorkWorkflow", {
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
        "durableWorkWorkflow",
      ),
    );

    await expect(ensureDurableWorkProcessor()).resolves.toBeUndefined();
  });
});
