// A7: executeSandbox must bail with a system_error status when storage
// returns zero sources (a system_error row from createQueuedSubmissionRecord
// that got rejudged). Without the guard, mergeSandboxSources returns an empty
// sourceCode and the verdict comes back as wrong_answer — masking the cause.

import type { SandboxExecutor, SubmissionDraft } from "@nojv/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateStatusMock, getSourcesMock, deriveModeMock } = vi.hoisted(() => ({
  updateStatusMock: vi.fn(),
  getSourcesMock: vi.fn(),
  deriveModeMock: vi.fn(() => "standard"),
}));

vi.mock("@nojv/domain", () => ({
  submissionDomain: {
    updateSubmissionStatus: updateStatusMock,
    getSubmissionSources: getSourcesMock,
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

    const judgeContext = {
      problemType: "full_source",
      judgeType: "standard",
      samples: [],
      testcaseSets: [],
      workspaceFiles: [],
      runtime: { timeLimitMs: 1_000, memoryLimitMb: 256, env: {} },
      checkerScript: null,
      interactorScript: null,
      advanced: null,
      subtaskStrategies: {},
      adjustment: {
        assignmentAdjustmentRules: null,
        dueAt: null,
        finalDay: null,
        submittedAt: new Date(0),
      },
    } as unknown as Parameters<typeof executeSandbox>[2];

    const result = await executeSandbox("sub_missing", draft, judgeContext);

    expect(executor.execute).not.toHaveBeenCalled();
    // Status: first the `running` flip, then the `system_error` bail.
    expect(updateStatusMock).toHaveBeenCalledTimes(2);
    expect(updateStatusMock).toHaveBeenNthCalledWith(1, "sub_missing", "running");
    expect(updateStatusMock).toHaveBeenNthCalledWith(2, "sub_missing", "system_error");

    // The result blob's verdict cannot be `system_error` (not in
    // submissionVerdictSchema), so the activity falls back to runtime_error.
    // The row status is the authoritative signal.
    expect(result.verdict).toBe("runtime_error");
    expect(result.score).toBe(0);
    expect(result.accepted).toBe(false);
    expect(result.caseResults).toEqual([]);
    expect(result.feedback).toMatch(/missing from storage/i);
  });
});
