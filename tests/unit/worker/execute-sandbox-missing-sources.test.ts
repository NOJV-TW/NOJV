import type { SandboxExecutor, SubmissionDraft } from "@nojv/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateStatusMock, getSourcesMock, getJudgeContextMock, deriveModeMock } = vi.hoisted(
  () => ({
    updateStatusMock: vi.fn(),
    getSourcesMock: vi.fn(),
    getJudgeContextMock: vi.fn(),
    deriveModeMock: vi.fn(() => "standard"),
  }),
);

vi.mock("@nojv/application", () => ({
  submissionDomain: {
    updateSubmissionStatus: updateStatusMock,
    getSubmissionSources: getSourcesMock,
    getJudgeContext: getJudgeContextMock,
    deriveJudgeMode: deriveModeMock,
  },
}));

import { executeSandbox, setExecutor } from "../../../apps/worker/src/activities/judge";

describe("executeSandbox — missing sources guard (A7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deriveModeMock.mockReturnValue("standard");
  });

  it("returns system_error and skips the sandbox when storage has zero sources", async () => {
    const executor: SandboxExecutor = {
      execute: vi.fn(async () => {
        throw new Error("sandbox must not run when sources are missing");
      }),
    };
    setExecutor(executor);

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
    setExecutor(executor);
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
});
