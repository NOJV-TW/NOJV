import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { start } })),
}));

import { dispatchRegistryGarbageCollect } from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchRegistryGarbageCollect", () => {
  it("starts the platform workflow with the fixed 'registry-gc' id", async () => {
    start.mockResolvedValueOnce(undefined);

    const result = await dispatchRegistryGarbageCollect({ triggeredByUserId: "usr_admin" });

    expect(result).toEqual({ workflowId: "registry-gc", alreadyRunning: false });
    expect(start).toHaveBeenCalledTimes(1);
    const [workflowName, options] = start.mock.calls[0] as [string, { workflowId: string }];
    expect(workflowName).toBe("registryGarbageCollectWorkflow");
    expect(options.workflowId).toBe("registry-gc");
  });

  it("returns the already-running flag instead of throwing when a GC is in flight", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        "registry-gc",
        "registryGarbageCollectWorkflow",
      ),
    );

    const result = await dispatchRegistryGarbageCollect({ triggeredByUserId: "usr_admin" });

    expect(result).toEqual({ workflowId: "registry-gc", alreadyRunning: true });
  });

  it("rethrows unexpected start failures", async () => {
    start.mockRejectedValueOnce(new Error("temporal down"));

    await expect(
      dispatchRegistryGarbageCollect({ triggeredByUserId: "usr_admin" }),
    ).rejects.toThrow("temporal down");
  });
});
