import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));

import { spawnDockerContainer } from "../../../apps/worker/src/services/docker-process";

function child(autoClose: boolean) {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  if (autoClose) setTimeout(() => process.emit("close", 0), 0);
  return process;
}

describe("spawnDockerContainer cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kills the CLI, awaits bounded container removal, and rejects with the abort reason", async () => {
    const runChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? child(true) : runChild,
    );
    const controller = new AbortController();
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-run"],
      containerName: "judge-run",
      outerTimeoutMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));

    const reason = new DOMException("cancelled", "AbortError");
    controller.abort(reason);

    await expect(operation).rejects.toBe(reason);
    expect(runChild.kill).toHaveBeenCalledWith("SIGKILL");
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      "docker",
      ["rm", "-f", "judge-run"],
      expect.any(Object),
    );
  });

  it("settles a timeout after cleanup even when the Docker CLI never closes", async () => {
    const runChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? child(true) : runChild,
    );

    const result = await spawnDockerContainer({
      args: ["run", "--name", "judge-timeout"],
      containerName: "judge-timeout",
      outerTimeoutMs: 5,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    expect(runChild.kill).toHaveBeenCalledWith("SIGKILL");
    expect(mocks.spawn).toHaveBeenCalledTimes(3);
  });
});
