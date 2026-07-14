import type { SandboxExecutor, SubmissionDraft } from "@nojv/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateStatusMock,
  getSourcesMock,
  getJudgeContextMock,
  deriveModeMock,
  cancellationSignalMock,
} = vi.hoisted(() => ({
  updateStatusMock: vi.fn(),
  getSourcesMock: vi.fn(),
  getJudgeContextMock: vi.fn(),
  deriveModeMock: vi.fn(() => "standard"),
  cancellationSignalMock: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  cancellationSignal: cancellationSignalMock,
  heartbeat: vi.fn(),
}));

vi.mock("@nojv/application", () => ({
  submissionDomain: {
    updateSubmissionStatus: updateStatusMock,
    getSubmissionSources: getSourcesMock,
    getJudgeContext: getJudgeContextMock,
    deriveJudgeMode: deriveModeMock,
  },
}));

import { executeSandbox, setExecutorOwner } from "../../../apps/worker/src/activities/judge";
import { ExecutorOwner } from "../../../apps/worker/src/services/executor-owner";

function installExecutor(executor: SandboxExecutor): void {
  setExecutorOwner(new ExecutorOwner(executor, () => "test-run"));
}

describe("executeSandbox — missing sources guard (A7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deriveModeMock.mockReturnValue("standard");
    cancellationSignalMock.mockReturnValue(new AbortController().signal);
  });

  it("returns system_error and skips the sandbox when storage has zero sources", async () => {
    const executor: SandboxExecutor = {
      execute: vi.fn(async () => {
        throw new Error("sandbox must not run when sources are missing");
      }),
    };
    installExecutor(executor);

    getSourcesMock.mockResolvedValue([]);

    const draft: SubmissionDraft = {
      problemId: "prob_x",
      language: "python",
      sourceCode: "print(1)",
    };

    const result = await executeSandbox("sub_missing", draft);

    expect(executor.execute).not.toHaveBeenCalled();
    expect(updateStatusMock).toHaveBeenCalledTimes(1);
    expect(updateStatusMock).toHaveBeenNthCalledWith(1, "sub_missing", "running");

    expect(result.result.verdict).toBe("system_error");
    expect(result.result.score).toBe(0);
    expect(result.result.accepted).toBe(false);
    expect(result.result.caseResults).toEqual([]);
    expect(result.result.feedback).toMatch(/missing from storage/i);
    expect(result.advancedJudgeVerificationSnapshot).toBeNull();
  });

  it("refuses to judge sources that no longer satisfy the loaded Advanced contract", async () => {
    const executor: SandboxExecutor = { execute: vi.fn() };
    installExecutor(executor);
    getSourcesMock.mockResolvedValue([{ path: "old.py", content: "print(1)" }]);
    const config = {
      run: {
        imageRef: "ghcr.io/nojv-tw/run@sha256:" + "a".repeat(64),
        imageSource: "registry",
      },
      grade: {
        imageRef: "ghcr.io/nojv-tw/grade@sha256:" + "a".repeat(64),
        imageSource: "registry",
      },
      network: { mode: "none" },
      maxScore: 100,
    };
    getJudgeContextMock.mockResolvedValue({
      advanced: {
        config,
        requiredPaths: ["main.py"],
        resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
      },
    });

    const execution = await executeSandbox("sub_stale_paths", {
      problemId: "prob_x",
      language: "python",
      sourceCode: "print(1)",
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(execution.result).toMatchObject({ verdict: "system_error", accepted: false });
    expect(execution.result.feedback).toContain("main.py");
    expect(execution.advancedJudgeVerificationSnapshot).toEqual({
      config,
      requiredPaths: ["main.py"],
      resourceLimits: { totalTimeMs: 1_000, memoryMb: 256 },
    });
  });

  it("forwards Temporal cancellation to the owned executor", async () => {
    const temporalCancellation = new AbortController();
    cancellationSignalMock.mockReturnValue(temporalCancellation.signal);
    let observedSignal: AbortSignal | undefined;
    const executor: SandboxExecutor = {
      execute: vi.fn(async (_request, execution) => {
        observedSignal = execution.signal;
        await new Promise<void>((resolve) =>
          execution.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        throw execution.signal.reason;
      }),
    };
    installExecutor(executor);
    getSourcesMock.mockResolvedValue([{ path: "main.py", content: "print(1)" }]);
    getJudgeContextMock.mockResolvedValue({
      advanced: null,
      checkerScript: null,
      compareOptions: null,
      interactorScript: null,
      judgeType: "standard",
      problemType: "full_source",
      runtime: { env: {}, memoryLimitMb: 128, timeLimitMs: 1_000 },
      samples: [],
      testcaseSets: [],
      workspaceFiles: [],
    });

    const operation = executeSandbox("sub_cancel", {
      problemId: "prob_x",
      language: "python",
      sourceCode: "print(1)",
    });
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledOnce());
    const reason = new DOMException("Temporal cancelled", "AbortError");
    temporalCancellation.abort(reason);

    await expect(operation).rejects.toBe(reason);
    expect(observedSignal?.aborted).toBe(true);
  });
});
