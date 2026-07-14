import { afterEach, describe, expect, it, vi } from "vitest";

const { collectContainerLogsMock, forceRemoveContainerMock, runDockerMock } = vi.hoisted(
  () => ({
    collectContainerLogsMock: vi.fn(),
    forceRemoveContainerMock: vi.fn(),
    runDockerMock: vi.fn(),
  }),
);

vi.mock("../../../apps/worker/src/services/docker-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/worker/src/services/docker-process")
  >()),
  collectContainerLogs: collectContainerLogsMock,
  forceRemoveContainer: forceRemoveContainerMock,
  runDocker: runDockerMock,
  sanitizeId: (value: string) => value,
}));

import {
  startServiceContainer,
  waitForServiceReady,
} from "../../../apps/worker/src/services/service-container";

afterEach(() => {
  vi.useRealTimers();
  collectContainerLogsMock.mockReset();
  forceRemoveContainerMock.mockReset();
  runDockerMock.mockReset();
});

describe("waitForServiceReady", () => {
  it("returns only after the service emits the exact readiness marker", async () => {
    collectContainerLogsMock
      .mockResolvedValueOnce("booting")
      .mockResolvedValueOnce("NOJV_SERVICE_READY\n");
    vi.useFakeTimers();

    const ready = waitForServiceReady("service-1", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);

    await expect(ready).resolves.toBeUndefined();
  });

  it("preserves readiness failure identity while exposing cleanup failure", async () => {
    const readinessFailure = new Error("service readiness probe failed");
    collectContainerLogsMock.mockRejectedValue(readinessFailure);
    runDockerMock.mockResolvedValue(undefined);
    forceRemoveContainerMock.mockRejectedValue(new Error("container cleanup denied"));

    const operation = startServiceContainer({
      runId: "readiness-cleanup",
      internalName: "nojv-net-internal-readiness-cleanup",
      imageRef: "service:test",
      memoryMb: 256,
      cpuLimit: "1",
      pidsLimit: 64,
      signal: new AbortController().signal,
      labels: {},
    });

    await expect(operation).rejects.toBe(readinessFailure);
    expect(readinessFailure.message).toContain("service readiness probe failed");
    expect(readinessFailure.message).toContain("Docker service container cleanup failed");
    expect(readinessFailure.message).toContain("container cleanup denied");
  });

  it("fails closed when the service never becomes ready", async () => {
    collectContainerLogsMock.mockResolvedValue("");
    vi.useFakeTimers();

    const ready = waitForServiceReady("service-1", new AbortController().signal);
    const assertion = expect(ready).rejects.toThrow(
      "service service-1 did not become ready within timeout",
    );
    await vi.advanceTimersByTimeAsync(5_100);

    await assertion;
  });
});
