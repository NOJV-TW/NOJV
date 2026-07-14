import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SandboxRequest } from "@nojv/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSubmissionNetwork: vi.fn(),
  removeSubmissionNetwork: vi.fn(),
  spawnDockerContainer: vi.fn(),
  startServiceContainer: vi.fn(),
  stopServiceContainer: vi.fn(),
}));

vi.mock("../../../apps/worker/src/services/docker-network", () => ({
  createSubmissionNetwork: mocks.createSubmissionNetwork,
  removeSubmissionNetwork: mocks.removeSubmissionNetwork,
}));

vi.mock("../../../apps/worker/src/services/docker-process", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/worker/src/services/docker-process")
  >()),
  spawnDockerContainer: mocks.spawnDockerContainer,
}));

vi.mock("../../../apps/worker/src/services/service-container", () => ({
  ADVANCED_SERVICE_PORT: 8888,
  SERVICE_HOST_ENV: "NOJV_SERVICE_HOST",
  SERVICE_NETWORK_ALIAS: "service",
  buildServiceEnv: () => ({ NOJV_SERVICE_HOST: "service:8888" }),
  collectServiceLogs: vi.fn().mockResolvedValue(""),
  startServiceContainer: mocks.startServiceContainer,
  stopServiceContainer: mocks.stopServiceContainer,
}));

import { AdvancedModeExecutor } from "../../../apps/worker/src/services/advanced-mode-executor";

const request: SandboxRequest = {
  submissionId: "cleanup-submission",
  sourceCode: "print('ok')",
  language: "python",
  problemType: "special_env",
  testcases: [],
  judgeType: "standard",
  judgeConfig: {},
  limits: { timeoutMs: 1_000, memoryMb: 256 },
  advanced: {
    run: { imageRef: "run:test", imageSource: "registry" },
    grade: { imageRef: "grade:test", imageSource: "registry" },
    network: {
      mode: "service",
      service: { imageRef: "service:test", imageSource: "registry" },
    },
    totalTimeMs: 1_000,
    memoryMb: 256,
    maxScore: 100,
  },
};

describe("AdvancedModeExecutor Docker cleanup", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "nojv-advanced-cleanup-"));
    mocks.createSubmissionNetwork.mockResolvedValue({ internalName: "cleanup-network" });
    mocks.startServiceContainer.mockResolvedValue({ containerName: "cleanup-service" });
    mocks.spawnDockerContainer.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      sizeExceeded: false,
      spawnError: null,
    });
    mocks.removeSubmissionNetwork.mockResolvedValue(undefined);
    mocks.stopServiceContainer.mockRejectedValue(new Error("container cleanup denied"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("fails closed but still removes the network when container cleanup fails", async () => {
    const executor = new AdvancedModeExecutor();
    const operation = executor.run(
      tempDir,
      request,
      { runId: "cleanup-run", signal: new AbortController().signal },
      { cpuLimit: "1", pidsLimit: 64 },
    );

    await expect(operation).rejects.toThrow(/container cleanup denied/);
    expect(mocks.stopServiceContainer).toHaveBeenCalledWith("cleanup-service");
    expect(mocks.removeSubmissionNetwork).toHaveBeenCalledWith({
      internalName: "cleanup-network",
    });
  });
});
