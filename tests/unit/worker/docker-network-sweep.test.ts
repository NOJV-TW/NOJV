import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDocker: vi.fn(),
  runDockerCommand: vi.fn(),
}));

vi.mock("../../../apps/worker/src/services/docker-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/worker/src/services/docker-process")
  >()),
  runDocker: mocks.runDocker,
  runDockerCommand: mocks.runDockerCommand,
}));

import { sweepOrphanNetworks } from "../../../apps/worker/src/services/docker-network";
import {
  DOCKER_CREATED_AT_LABEL,
  DOCKER_EXPIRES_AT_LABEL,
  DOCKER_MANAGED_LABEL,
  DOCKER_RUN_LABEL,
  DOCKER_WORKER_LABEL,
} from "../../../apps/worker/src/services/docker-resource";

function inspection(params: { expiresAt: number; worker?: string; active?: boolean }): string {
  return JSON.stringify([
    {
      Labels: {
        [DOCKER_MANAGED_LABEL]: "true",
        ...(params.worker === undefined ? {} : { [DOCKER_WORKER_LABEL]: params.worker }),
        [DOCKER_RUN_LABEL]: "run-a",
        [DOCKER_CREATED_AT_LABEL]: "1000",
        [DOCKER_EXPIRES_AT_LABEL]: String(params.expiresAt),
      },
      Containers: params.active ? { container: { Name: "still-running" } } : {},
    },
  ]);
}

describe("Docker network sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only expired, unattached, fully-owned network IDs", async () => {
    mocks.runDockerCommand.mockImplementation((args: string[]) => {
      if (args[0] === "network" && args[1] === "ls") {
        return Promise.resolve({ stdout: "expired\nactive\nfuture\npartial\n", stderr: "" });
      }
      if (args[1] === "inspect") {
        const values: Record<string, string> = {
          expired: inspection({ expiresAt: 2_000, worker: "worker-a" }),
          active: inspection({ expiresAt: 2_000, worker: "worker-b", active: true }),
          future: inspection({ expiresAt: 9_000, worker: "worker-b" }),
          partial: inspection({ expiresAt: 2_000 }),
        };
        return Promise.resolve({ stdout: values[args[2]!]!, stderr: "" });
      }
      if (args[1] === "rm") return Promise.resolve({ stdout: "", stderr: "" });
      throw new Error(`Unexpected docker args: ${args.join(" ")}`);
    });

    await sweepOrphanNetworks(5_000);

    expect(mocks.runDockerCommand).toHaveBeenCalledWith(["network", "rm", "expired"], {
      ignoreMissingResource: true,
    });
    expect(mocks.runDockerCommand).not.toHaveBeenCalledWith(
      expect.arrayContaining(["rm", "active"]),
      expect.anything(),
    );
    expect(mocks.runDockerCommand).not.toHaveBeenCalledWith(
      expect.arrayContaining(["rm", "future"]),
      expect.anything(),
    );
    expect(mocks.runDockerCommand).not.toHaveBeenCalledWith(
      expect.arrayContaining(["rm", "partial"]),
      expect.anything(),
    );
  });
});
