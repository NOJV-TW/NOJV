import { afterEach, describe, expect, it, vi } from "vitest";

const { collectContainerLogsMock } = vi.hoisted(() => ({
  collectContainerLogsMock: vi.fn(),
}));

vi.mock("../../../apps/worker/src/services/docker-process", () => ({
  collectContainerLogs: collectContainerLogsMock,
  forceRemoveContainer: vi.fn(),
  forceRemoveContainerSync: vi.fn(),
  runDocker: vi.fn(),
  sanitizeId: (value: string) => value,
}));

import { waitForServiceReady } from "../../../apps/worker/src/services/service-container";

afterEach(() => {
  vi.useRealTimers();
  collectContainerLogsMock.mockReset();
});

describe("waitForServiceReady", () => {
  it("returns only after the service emits the exact readiness marker", async () => {
    collectContainerLogsMock
      .mockResolvedValueOnce("booting")
      .mockResolvedValueOnce("NOJV_SERVICE_READY\n");
    vi.useFakeTimers();

    const ready = waitForServiceReady("service-1");
    await vi.advanceTimersByTimeAsync(100);

    await expect(ready).resolves.toBeUndefined();
  });

  it("fails closed when the service never becomes ready", async () => {
    collectContainerLogsMock.mockResolvedValue("");
    vi.useFakeTimers();

    const ready = waitForServiceReady("service-1");
    const assertion = expect(ready).rejects.toThrow(
      "service service-1 did not become ready within timeout",
    );
    await vi.advanceTimersByTimeAsync(5_100);

    await assertion;
  });
});
