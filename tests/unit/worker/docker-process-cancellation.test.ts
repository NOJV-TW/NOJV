import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

import {
  DockerCommandError,
  collectContainerLogs,
  forceRemoveContainer,
  spawnDockerContainer,
} from "../../../apps/worker/src/services/docker-process";

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
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      "docker",
      ["run", "--name", "judge-run"],
      expect.any(Object),
    );

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

  it("preserves cancellation identity and serializes a simultaneous cleanup failure", async () => {
    const runChild = child(false);
    const cleanupChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? cleanupChild : runChild,
    );
    const controller = new AbortController();
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-cancel-cleanup"],
      containerName: "judge-cancel-cleanup",
      outerTimeoutMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));

    const reason = new DOMException("cancelled by Temporal", "AbortError");
    controller.abort(reason);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    cleanupChild.stderr.write("permission denied while removing container");
    cleanupChild.emit("close", 1);

    await expect(operation).rejects.toBe(reason);
    expect(reason.message).toContain("cancelled by Temporal");
    expect(reason.message).toContain("Docker container cleanup failed");
    expect(reason.message).toContain("permission denied while removing container");
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
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
  });

  it("gives a late abort priority over a timeout while cleanup is pending", async () => {
    const runChild = child(false);
    const cleanupChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? cleanupChild : runChild,
    );
    const controller = new AbortController();
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-timeout-cancel"],
      containerName: "judge-timeout-cancel",
      outerTimeoutMs: 5,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));

    const reason = new DOMException("cancelled during timeout cleanup", "AbortError");
    controller.abort(reason);
    cleanupChild.emit("close", 0);

    await expect(operation).rejects.toBe(reason);
  });

  it("gives a late abort priority over a size limit while cleanup is pending", async () => {
    const runChild = child(false);
    const cleanupChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? cleanupChild : runChild,
    );
    const controller = new AbortController();
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-size-cancel"],
      containerName: "judge-size-cancel",
      outerTimeoutMs: 60_000,
      signal: controller.signal,
      watch: {
        dir: "/tmp/judge-size-cancel",
        intervalMs: 1,
        exceeds: vi.fn().mockResolvedValue(true),
      },
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));

    const reason = new DOMException("cancelled during size cleanup", "AbortError");
    controller.abort(reason);
    cleanupChild.emit("close", 0);

    await expect(operation).rejects.toBe(reason);
  });

  it("fails closed and removes the container when the workspace size check fails", async () => {
    const runChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? child(true) : runChild,
    );
    const watchFailure = new Error("workspace stat failed");
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-watch-failure"],
      containerName: "judge-watch-failure",
      outerTimeoutMs: 60_000,
      signal: new AbortController().signal,
      watch: {
        dir: "/tmp/judge-watch-failure",
        intervalMs: 1,
        exceeds: vi.fn().mockRejectedValue(watchFailure),
      },
    });

    await expect(operation).rejects.toBe(watchFailure);
    expect(runChild.kill).toHaveBeenCalledWith("SIGKILL");
    expect(mocks.spawn).toHaveBeenLastCalledWith(
      "docker",
      ["rm", "-f", "judge-watch-failure"],
      expect.any(Object),
    );
  });

  it("preserves a workspace check failure while serializing cleanup failure", async () => {
    const runChild = child(false);
    const cleanupChild = child(false);
    mocks.spawn.mockImplementation((_command: string, args: string[]) =>
      args[0] === "rm" ? cleanupChild : runChild,
    );
    const watchFailure = new Error("workspace stat failed");
    const operation = spawnDockerContainer({
      args: ["run", "--name", "judge-watch-cleanup-failure"],
      containerName: "judge-watch-cleanup-failure",
      outerTimeoutMs: 60_000,
      signal: new AbortController().signal,
      watch: {
        dir: "/tmp/judge-watch-cleanup-failure",
        intervalMs: 1,
        exceeds: vi.fn().mockRejectedValue(watchFailure),
      },
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));
    cleanupChild.stderr.write("workspace container removal denied");
    cleanupChild.emit("close", 1);

    await expect(operation).rejects.toBe(watchFailure);
    expect(watchFailure.message).toContain("workspace stat failed");
    expect(watchFailure.message).toContain("Docker container cleanup failed");
    expect(watchFailure.message).toContain("workspace container removal denied");
  });

  it("treats only Docker's exact missing-container result as idempotent cleanup", async () => {
    const missing = child(false);
    mocks.spawn.mockReturnValueOnce(missing);
    const cleanup = forceRemoveContainer("already-gone");
    missing.stderr.write("Error response from daemon: No such container: already-gone");
    missing.emit("close", 1);
    await expect(cleanup).resolves.toBeUndefined();

    const denied = child(false);
    mocks.spawn.mockReturnValueOnce(denied);
    const rejected = forceRemoveContainer("owned-but-busy");
    denied.stderr.write("permission denied");
    denied.emit("close", 1);
    await expect(rejected).rejects.toBeInstanceOf(DockerCommandError);
  });

  it("surfaces Docker log spawn failures instead of returning empty logs", async () => {
    const failed = child(false);
    mocks.spawn.mockReturnValueOnce(failed);
    const logs = collectContainerLogs("service-a", new AbortController().signal);
    failed.emit("error", new Error("docker executable missing"));
    await expect(logs).rejects.toMatchObject({ failure: "spawn" });
  });
});
