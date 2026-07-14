import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDockerCommand: vi.fn(),
}));

vi.mock("../../../apps/worker/src/services/docker-process", () => ({
  runDockerCommand: mocks.runDockerCommand,
}));

import { sweepOrphanContainers } from "../../../apps/worker/src/services/docker-container";
import {
  DOCKER_CREATED_AT_LABEL,
  DOCKER_EXPIRES_AT_LABEL,
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
  DOCKER_WORKER_LABEL,
} from "../../../apps/worker/src/services/docker-resource";
import { DockerResourceSweeper } from "../../../apps/worker/src/services/docker-resource-sweeper";

function containerInspection(expiresAt: number): string {
  return JSON.stringify([
    {
      Config: {
        Labels: {
          [DOCKER_MANAGED_LABEL]: "true",
          [DOCKER_WORKER_LABEL]: "crashed-worker",
          [DOCKER_RUN_LABEL]: "run-a",
          [DOCKER_CREATED_AT_LABEL]: "500",
          [DOCKER_EXPIRES_AT_LABEL]: String(expiresAt),
        },
      },
    },
  ]);
}

describe("DockerResourceSweeper", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("revisits a crash orphan after its TTL without requiring another worker restart", async () => {
    mocks.runDockerCommand.mockImplementation((args: string[]) => {
      if (args[0] === "container" && args[1] === "ls") {
        return Promise.resolve({ stdout: "orphan", stderr: "" });
      }
      if (args[0] === "container" && args[1] === "inspect") {
        return Promise.resolve({ stdout: containerInspection(1_500), stderr: "" });
      }
      if (args[0] === "container" && args[1] === "rm") {
        return Promise.resolve({ stdout: "", stderr: "" });
      }
      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });
    const sweepNetworks = vi.fn().mockResolvedValue(undefined);
    const sweeper = new DockerResourceSweeper(
      { sweepContainers: sweepOrphanContainers, sweepNetworks },
      1_000,
    );

    await sweeper.start();
    expect(mocks.runDockerCommand).not.toHaveBeenCalledWith(
      ["container", "rm", "--force", "orphan"],
      expect.anything(),
    );

    vi.setSystemTime(2_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.runDockerCommand).toHaveBeenCalledWith(
      ["container", "rm", "--force", "orphan"],
      { ignoreMissingResource: true },
    );
    expect(sweepNetworks).toHaveBeenCalledTimes(2);

    await sweeper.shutdown();
    await expect(sweeper.done).resolves.toBeUndefined();
  });

  it("surfaces a periodic sweep failure and stops scheduling work", async () => {
    const sweepContainers = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Docker unavailable"));
    const sweepNetworks = vi.fn().mockResolvedValue(undefined);
    const sweeper = new DockerResourceSweeper({ sweepContainers, sweepNetworks }, 1_000);

    await sweeper.start();
    const failure = expect(sweeper.done).rejects.toThrow("Docker unavailable");
    await vi.advanceTimersByTimeAsync(1_000);

    await failure;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sweepContainers).toHaveBeenCalledTimes(2);
    await sweeper.shutdown();
  });
});
