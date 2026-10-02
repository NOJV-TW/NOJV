import type { DeferredStageCleanup, SandboxExecutionContext, SandboxResult } from "@nojv/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const domain = vi.hoisted(() => ({
  claimJudgeLease: vi.fn(),
  heartbeatJudgeStage: vi.fn(),
  loadJudgeExecution: vi.fn(),
  setJudgeExecutionState: vi.fn(),
  saveJudgeStage: vi.fn(),
  releaseJudgeStage: vi.fn(),
}));
const owner = vi.hoisted(() => ({ execute: vi.fn(), cleanupStage: vi.fn() }));

vi.mock("@nojv/application", () => ({ submissionDomain: domain }));
vi.mock("@nojv/db", () => ({ prismaAdapterClient: {} }));
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@temporalio/activity")>()),
  heartbeat: vi.fn(),
  cancellationSignal: () => new AbortController().signal,
}));
vi.mock("../../../apps/worker/src/activities/judge-request", () => ({
  buildSandboxRequest: () => ({
    problemType: "full_source",
    judgeType: "standard",
    language: "c",
    limits: { timeoutMs: 1_000, memoryMb: 128 },
    testcases: [{ index: 0, input: "1\n", output: "1\n", weight: 1, isSample: false }],
  }),
  mapSandboxResult: vi.fn(),
}));
vi.mock("../../../apps/worker/src/activities/judge", () => ({ getExecutorOwner: () => owner }));

import {
  cleanupJudgeStage,
  executeJudgeStage,
} from "../../../apps/worker/src/activities/judge-execution";

const cleanup: DeferredStageCleanup = {
  jobName: "judge-lease-1",
  namespace: "nojv-sandbox",
  payloadNames: ["judge-lease-1-run-pm"],
  deadlineSeconds: 120,
};
const accepted: SandboxResult = {
  testcaseResults: [
    { index: 0, verdict: "AC", stdout: "1\n", stderr: "", exitCode: 0, timeMs: 1 },
  ],
};

function executeWith(result: SandboxResult, deferred: boolean) {
  owner.execute.mockImplementation(
    async (
      _request: unknown,
      _signal: AbortSignal,
      _runId: string,
      deferCleanup?: SandboxExecutionContext["deferCleanup"],
    ) => {
      if (deferred) deferCleanup?.(cleanup);
      return result;
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  domain.claimJudgeLease.mockResolvedValue({ status: "claimed", leaseToken: "lease-1" });
  domain.heartbeatJudgeStage.mockResolvedValue(true);
  domain.loadJudgeExecution.mockResolvedValue({ snapshot: {} });
  owner.cleanupStage.mockResolvedValue(undefined);
});

describe("executeJudgeStage", () => {
  it("returns the deferred cleanup and keeps the lease when asked to defer", async () => {
    executeWith(accepted, true);

    const stage = await executeJudgeStage("execution-1", "workflow-1", 0, true);

    expect(stage).toEqual({
      status: "finished",
      cleanup: { ...cleanup, leaseToken: "lease-1" },
    });
    expect(domain.saveJudgeStage).toHaveBeenCalledWith(
      "execution-1",
      "workflow-1",
      0,
      accepted,
      "lease-1",
      true,
      true,
    );
    expect(domain.releaseJudgeStage).not.toHaveBeenCalled();
    expect(owner.execute.mock.calls[0]?.[3]).toEqual(expect.any(Function));
  });

  it("cleans inline and releases the lease when not deferring", async () => {
    executeWith(accepted, false);

    const stage = await executeJudgeStage("execution-1", "workflow-1", 0);

    expect(stage).toEqual({ status: "finished" });
    expect(owner.execute.mock.calls[0]?.[3]).toBeUndefined();
    expect(domain.saveJudgeStage.mock.calls[0]?.[6]).toBe(false);
    expect(domain.releaseJudgeStage).toHaveBeenCalledWith(
      "execution-1",
      "workflow-1",
      "lease-1",
    );
  });

  it("cleans a deferred stage inline before reporting a system error", async () => {
    executeWith({ testcaseResults: [], overallVerdict: "SE" }, true);

    await expect(executeJudgeStage("execution-1", "workflow-1", 0, true)).rejects.toMatchObject(
      {
        type: "JudgeResultSystemError",
      },
    );

    expect(owner.cleanupStage).toHaveBeenCalledWith(cleanup, expect.any(AbortSignal));
    expect(domain.saveJudgeStage).not.toHaveBeenCalled();
    expect(domain.releaseJudgeStage).toHaveBeenCalledWith(
      "execution-1",
      "workflow-1",
      "lease-1",
    );
  });
  it("cleans a deferred stage inline when saving its result fails", async () => {
    executeWith(accepted, true);
    domain.saveJudgeStage.mockRejectedValue(
      new Error("Judge attempt no longer owns this execution."),
    );

    await expect(executeJudgeStage("execution-1", "workflow-1", 0, true)).rejects.toThrow(
      "no longer owns",
    );

    expect(owner.cleanupStage).toHaveBeenCalledWith(cleanup, expect.any(AbortSignal));
    expect(domain.releaseJudgeStage).toHaveBeenCalledWith(
      "execution-1",
      "workflow-1",
      "lease-1",
    );
  });
});

describe("cleanupJudgeStage", () => {
  it("cleans the deferred stage and then releases its lease", async () => {
    const order: string[] = [];
    owner.cleanupStage.mockImplementation(async () => {
      order.push("cleanup");
    });
    domain.releaseJudgeStage.mockImplementation(async () => {
      order.push("release");
    });

    await cleanupJudgeStage("execution-1", "workflow-1", { ...cleanup, leaseToken: "lease-1" });

    expect(owner.cleanupStage).toHaveBeenCalledWith(cleanup, expect.any(AbortSignal));
    expect(order).toEqual(["cleanup", "release"]);
    expect(domain.releaseJudgeStage).toHaveBeenCalledWith(
      "execution-1",
      "workflow-1",
      "lease-1",
    );
  });

  it("keeps the lease when cleanup fails", async () => {
    owner.cleanupStage.mockRejectedValue(new Error("delete denied"));

    await expect(
      cleanupJudgeStage("execution-1", "workflow-1", { ...cleanup, leaseToken: "lease-1" }),
    ).rejects.toThrow("delete denied");

    expect(domain.releaseJudgeStage).not.toHaveBeenCalled();
  });
});
