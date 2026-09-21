import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start, executeUpdate } = vi.hoisted(() => ({ start: vi.fn(), executeUpdate: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(() =>
    Promise.resolve({ workflow: { start, getHandle: () => ({ executeUpdate }) } }),
  ),
}));

import {
  dispatchRejudge,
  dispatchSubmissionJudge,
} from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("durable submission dispatch handlers", () => {
  it("awaits durable coordinator routing when enabled without direct queue starts", async () => {
    vi.stubEnv("JUDGE_CAPACITY_ROUTING", "true");
    await dispatchSubmissionJudge({
      submissionId: "routed",
      draft: { language: "cpp", problemId: "problem" },
      admissionOrder: { studentId: "student", submittedAt: 100 },
    });
    expect(start).not.toHaveBeenCalled();
    expect(executeUpdate).toHaveBeenCalledWith(
      "dispatchJudgeWorkflow",
      expect.objectContaining({
        args: [
          expect.objectContaining({
            workflowId: "judge-routed",
            workflowType: "submissionJudgeWorkflow",
          }),
        ],
      }),
    );
    executeUpdate.mockRejectedValueOnce(new Error("Coordinator unavailable"));
    await expect(
      dispatchRejudge(
        { mode: "single", submissionId: "routed", triggeredByUserId: "admin" },
        "rejudge-routed",
      ),
    ).rejects.toThrow("Coordinator unavailable");
    expect(start).not.toHaveBeenCalled();
  });

  it("uses a deterministic submission workflow id and rejects closed-run reuse", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        "judge-sub_1",
        "submissionJudgeWorkflow",
      ),
    );

    await expect(
      dispatchSubmissionJudge({
        submissionId: "sub_1",
        draft: { language: "cpp", problemId: "prob_1" },
      }),
    ).resolves.toBeUndefined();
    expect(start).toHaveBeenCalledWith(
      "submissionJudgeWorkflow",
      expect.objectContaining({
        workflowId: "judge-sub_1",
        workflowIdReusePolicy: "REJECT_DUPLICATE",
      }),
    );
  });

  it("deduplicates competing immediate and outbox dispatches by workflow id", async () => {
    start
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError(
          "already started",
          "judge-sub_1",
          "submissionJudgeWorkflow",
        ),
      );

    const job = {
      submissionId: "sub_1",
      draft: { language: "cpp" as const, problemId: "prob_1" },
    };
    await expect(
      Promise.all([dispatchSubmissionJudge(job), dispatchSubmissionJudge(job)]),
    ).resolves.toEqual([undefined, undefined]);

    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]?.[1]).toMatchObject({ workflowId: "judge-sub_1" });
    expect(start.mock.calls[1]?.[1]).toMatchObject({ workflowId: "judge-sub_1" });
  });

  it("uses the persisted rejudge workflow id and rejects closed-run reuse", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        "rejudge-fixed",
        "rejudgeWorkflow",
      ),
    );

    await expect(
      dispatchRejudge(
        { mode: "single", submissionId: "sub_1", triggeredByUserId: "usr_1" },
        "rejudge-fixed",
      ),
    ).resolves.toEqual({ workflowId: "rejudge-fixed" });
    expect(start).toHaveBeenCalledWith(
      "rejudgeWorkflow",
      expect.objectContaining({
        workflowId: "rejudge-fixed",
        workflowIdReusePolicy: "REJECT_DUPLICATE",
      }),
    );
  });
});
