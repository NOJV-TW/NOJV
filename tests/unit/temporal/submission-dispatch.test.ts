import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start, describeWorkflow, signal, executeUpdate } = vi.hoisted(() => ({
  start: vi.fn(),
  executeUpdate: vi.fn(),
  describeWorkflow: vi.fn(),
  signal: vi.fn(),
}));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(() =>
    Promise.resolve({
      workflow: {
        start,
        getHandle: () => ({ describe: describeWorkflow, signal, executeUpdate }),
      },
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
  vi.unstubAllEnvs();
});

describe("durable submission dispatch handlers", () => {
  it("starts the durable judge workflow on the judge queue with its priority", async () => {
    await dispatchJudgeExecution({
      executionId: "execution",
      workflowId: "judge-execution-execution-0",
      priority: { priorityKey: 1, fairnessKey: "student" },
    });
    expect(executeUpdate).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith("durableJudgeWorkflow", {
      workflowId: "judge-execution-execution-0",
      taskQueue: "judge",
      workflowIdReusePolicy: "REJECT_DUPLICATE",
      priority: { priorityKey: 1, fairnessKey: "student" },
      args: [{ executionId: "execution" }],
    });
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
  it("treats an already running durable execution as dispatched", async () => {
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError("exists", "execution-1", "durableJudgeWorkflow"),
    );
    await expect(
      dispatchJudgeExecution({
        executionId: "execution",
        workflowId: "execution-1",
        priority: { priorityKey: 3, fairnessKey: "student" },
      }),
    ).resolves.toBeUndefined();
    expect(signal).not.toHaveBeenCalled();
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
