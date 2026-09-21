import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start, describeWorkflow, signal } = vi.hoisted(() => ({
  start: vi.fn(),
  describeWorkflow: vi.fn(),
  signal: vi.fn(),
}));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(() =>
    Promise.resolve({
      workflow: { start, getHandle: () => ({ describe: describeWorkflow, signal }) },
    }),
  ),
}));

import {
  dispatchJudgeExecution,
  describeSubmissionJudge,
  dispatchRejudge,
  dispatchSubmissionJudge,
} from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("durable submission dispatch handlers", () => {
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
  it("wakes an existing durable execution without starting a replacement", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError("exists", "execution-1", "durableJudgeWorkflow"),
    );
    await dispatchJudgeExecution({ executionId: "execution", workflowId: "execution-1" });
    expect(signal).toHaveBeenCalledWith("capacityAvailable");
  });
  it("distinguishes queued workflow tasks from repeatedly failing tasks", async () => {
    const task = { originalScheduledTime: { seconds: 1 }, attempt: 1 };
    describeWorkflow.mockResolvedValue({
      status: { name: "RUNNING" },
      raw: { pendingWorkflowTask: task, pendingActivities: [] },
    });
    expect(await describeSubmissionJudge("submission", "execution-1")).toMatchObject({
      running: true,
      pendingWorkflowTaskAt: null,
    });
    task.attempt = 3;
    expect(await describeSubmissionJudge("submission", "execution-1")).toMatchObject({
      pendingWorkflowTaskAt: new Date(1000),
    });
  });
});
