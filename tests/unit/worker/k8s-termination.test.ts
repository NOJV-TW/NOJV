import { describe, expect, it, vi } from "vitest";
import { terminateSandboxJob } from "../../../apps/worker/src/sandbox/kubernetes/termination";

const pod = {
  metadata: { name: "old-pod", uid: "pod-uid", ownerReferences: [{ uid: "job-uid" }] },
};
function clients() {
  const core = { listNamespacedPod: vi.fn().mockResolvedValue({ items: [] }) };
  const batch = {
    readNamespacedJob: vi.fn().mockResolvedValue({ metadata: { uid: "job-uid" } }),
    deleteNamespacedJob: vi.fn().mockResolvedValue(undefined),
  };
  return { core, batch };
}

describe("sandbox termination barrier", () => {
  it("uses UID preconditions and waits beyond delete acceptance", async () => {
    const { core, batch } = clients();
    core.listNamespacedPod
      .mockResolvedValueOnce({ items: [pod] })
      .mockResolvedValueOnce({ items: [pod] })
      .mockResolvedValue({ items: [] });
    await terminateSandboxJob(core as never, batch as never, "sandbox", "judge-run", {
      pollMs: 1,
    });
    expect(batch.deleteNamespacedJob).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { propagationPolicy: "Foreground", preconditions: { uid: "job-uid" } },
      }),
    );
    expect(core.listNamespacedPod).toHaveBeenCalledTimes(3);
  });
  it("reports cleanup_pending when FailedKillPod leaves the old Pod present", async () => {
    const { core, batch } = clients();
    core.listNamespacedPod.mockResolvedValue({ items: [pod] });
    await expect(
      terminateSandboxJob(core as never, batch as never, "sandbox", "judge-run", {
        timeoutMs: 0,
      }),
    ).rejects.toThrow("cleanup_pending");
  });
  it("refuses to delete a replacement owner's Pod", async () => {
    const { core, batch } = clients();
    core.listNamespacedPod.mockResolvedValue({
      items: [{ metadata: { ...pod.metadata, ownerReferences: [{ uid: "replacement-job" }] } }],
    });
    await expect(
      terminateSandboxJob(core as never, batch as never, "sandbox", "judge-run"),
    ).rejects.toThrow("ownership mismatch");
    expect(batch.deleteNamespacedJob).not.toHaveBeenCalled();
  });
  it("does not treat API unavailability as termination", async () => {
    const { core, batch } = clients();
    core.listNamespacedPod.mockRejectedValue(new Error("API unavailable"));
    await expect(
      terminateSandboxJob(core as never, batch as never, "sandbox", "judge-run"),
    ).rejects.toThrow("API unavailable");
  });
});

describe("shared cleanup deadline and UID barriers", () => {
  it("uses normal Pod grace and refuses a replacement UID after deletion", async () => {
    const { terminateSandboxPod } =
      await import("../../../apps/worker/src/sandbox/kubernetes/termination");
    const core = {
      listNamespacedPod: vi
        .fn()
        .mockResolvedValueOnce({ items: [pod] })
        .mockResolvedValue({ items: [{ metadata: { name: "old-pod", uid: "new-uid" } }] }),
      deleteNamespacedPod: vi.fn().mockResolvedValue(undefined),
    };
    await expect(terminateSandboxPod(core as never, "sandbox", "old-pod")).rejects.toThrow(
      "ownership changed",
    );
    expect(core.deleteNamespacedPod).toHaveBeenCalledWith({
      namespace: "sandbox",
      name: "old-pod",
      body: { propagationPolicy: "Foreground", preconditions: { uid: "pod-uid" } },
    });
  });

  it("never deletes a Pod that replaced the cleanup inventory's UID", async () => {
    const { terminateSandboxPod } =
      await import("../../../apps/worker/src/sandbox/kubernetes/termination");
    const core = {
      listNamespacedPod: vi.fn().mockResolvedValue({ items: [pod] }),
      deleteNamespacedPod: vi.fn(),
    };
    await expect(
      terminateSandboxPod(core as never, "sandbox", "old-pod", {
        expectedUid: "different-uid",
      }),
    ).rejects.toThrow("ownership changed");
    expect(core.deleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("includes every API call and retry in the single 30-second termination budget", async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      const delayed = <T>(value: T) =>
        new Promise<T>((resolve) => setTimeout(() => resolve(value), 4000));
      const core = { listNamespacedPod: vi.fn(() => delayed({ items: [pod] })) };
      const batch = {
        readNamespacedJob: vi.fn(() => delayed({ metadata: { uid: "job-uid" } })),
        deleteNamespacedJob: vi.fn(() => delayed(undefined)),
      };
      const cleanup = terminateSandboxJob(
        core as never,
        batch as never,
        "sandbox",
        "judge-run",
      );
      await Promise.all([
        expect(cleanup).rejects.toThrow("cleanup_pending"),
        vi.advanceTimersByTimeAsync(30_000),
      ]);
      expect(Date.now() - started).toBe(30_000);
      const calls = core.listNamespacedPod.mock.calls.length;
      await vi.runAllTimersAsync();
      expect(core.listNamespacedPod).toHaveBeenCalledTimes(calls);
    } finally {
      vi.useRealTimers();
    }
  });
});
