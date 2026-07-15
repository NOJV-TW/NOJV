import { beforeEach, describe, expect, it, vi } from "vitest";

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

function inspection(params: { expiresAt: number; worker?: string }): string {
  return JSON.stringify([
    {
      Config: {
        Labels: {
          [DOCKER_MANAGED_LABEL]: "true",
          ...(params.worker === undefined ? {} : { [DOCKER_WORKER_LABEL]: params.worker }),
          [DOCKER_RUN_LABEL]: "run-a",
          [DOCKER_CREATED_AT_LABEL]: "1000",
          [DOCKER_EXPIRES_AT_LABEL]: String(params.expiresAt),
        },
      },
    },
  ]);
}

describe("Docker container sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("force-removes only expired containers with the complete ownership contract", async () => {
    mocks.runDockerCommand.mockImplementation((args: string[]) => {
      if (args[0] === "container" && args[1] === "ls") {
        return Promise.resolve({ stdout: "expired\nactive\nfuture\npartial\n", stderr: "" });
      }
      if (args[1] === "inspect") {
        const values: Record<string, string> = {
          expired: inspection({ expiresAt: 2_000, worker: "worker-a" }),
          active: inspection({ expiresAt: 9_000, worker: "worker-a" }),
          future: inspection({ expiresAt: 9_000, worker: "worker-b" }),
          partial: inspection({ expiresAt: 2_000 }),
        };
        return Promise.resolve({ stdout: values[args[2]], stderr: "" });
      }
      if (args[1] === "rm") return Promise.resolve({ stdout: "", stderr: "" });
      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });

    await sweepOrphanContainers(5_000);

    expect(mocks.runDockerCommand).toHaveBeenCalledWith(
      ["container", "rm", "--force", "expired"],
      { ignoreMissingResource: true },
    );
    for (const retained of ["active", "future", "partial"]) {
      expect(mocks.runDockerCommand).not.toHaveBeenCalledWith(
        expect.arrayContaining(["rm", retained]),
        expect.anything(),
      );
    }
  });
});
