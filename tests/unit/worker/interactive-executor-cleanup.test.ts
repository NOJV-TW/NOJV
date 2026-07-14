import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { SandboxRequest } from "@nojv/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

import { runInteractiveMode } from "../../../apps/worker/src/services/interactive-executor";

function child() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}

const request: SandboxRequest = {
  submissionId: "interactive-cleanup",
  sourceCode: "print('ready')",
  language: "python",
  problemType: "full_source",
  testcases: [{ index: 0, input: "1\n", output: "1\n", weight: 1, isSample: false }],
  judgeType: "interactive",
  judgeConfig: { interactorScript: "accept()", interactorLanguage: "python" },
  limits: { timeoutMs: 1_000, memoryMb: 256 },
};

describe("interactive Docker cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves cancellation identity and serializes both container cleanup failures", async () => {
    const solution = child();
    const interactor = child();
    const solutionCleanup = child();
    const interactorCleanup = child();
    mocks.spawn
      .mockReturnValueOnce(solution)
      .mockReturnValueOnce(interactor)
      .mockReturnValueOnce(solutionCleanup)
      .mockReturnValueOnce(interactorCleanup);
    const controller = new AbortController();
    const operation = runInteractiveMode(
      request,
      { runId: "interactive-cleanup", signal: controller.signal },
      { cpuLimit: "1", image: "sandbox@sha256:test", memoryMb: 256, pidsLimit: 64 },
    );
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(2));

    const reason = new DOMException("interactive cancelled", "AbortError");
    controller.abort(reason);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(3));
    solutionCleanup.stderr.write("solution cleanup denied");
    solutionCleanup.emit("close", 1);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(4));
    interactorCleanup.stderr.write("interactor cleanup denied");
    interactorCleanup.emit("close", 1);

    await expect(operation).rejects.toBe(reason);
    expect(reason.message).toContain("interactive cancelled");
    expect(reason.message).toContain("solution cleanup denied");
    expect(reason.message).toContain("interactor cleanup denied");
    expect(solution.kill).toHaveBeenCalledWith("SIGKILL");
    expect(interactor.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
