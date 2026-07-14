import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { describeWorkflow, start, terminate, getHandle } = vi.hoisted(() => {
  const describeWorkflow = vi.fn();
  const start = vi.fn();
  const terminate = vi.fn();
  const getHandle = vi.fn((_workflowId: string, runId?: string) =>
    runId ? { terminate } : { describe: describeWorkflow },
  );
  return { describeWorkflow, start, terminate, getHandle };
});

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(() => Promise.resolve({ workflow: { getHandle, start } })),
}));

import {
  cancelExamAutoClose,
  ensureExamAutoClose,
  replaceExamAutoClose,
} from "../../../packages/temporal/src/dispatch";

const input = {
  examId: "exam_1",
  startsAt: "2030-01-01T09:00:00.000Z",
  endsAt: "2030-01-01T10:00:00.000Z",
  scheduleRevision: 4,
  timerFingerprint: "exam:v1:exam_1:window_b",
};

function execution(
  scheduleRevision = input.scheduleRevision,
  timerFingerprint = input.timerFingerprint,
  status = "RUNNING",
  runId = "run_1",
) {
  return {
    memo: { scheduleRevision, timerFingerprint },
    runId,
    status: { name: status },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue(undefined);
  terminate.mockResolvedValue(undefined);
});

describe("lifecycle dispatch reconciliation", () => {
  it("starts an absent lifecycle with immutable identity in args and memo", async () => {
    describeWorkflow
      .mockRejectedValueOnce(
        new WorkflowNotFoundError("not found", "exam-auto-close-exam_1", ""),
      )
      .mockResolvedValueOnce(execution());

    await ensureExamAutoClose(input);

    expect(start).toHaveBeenCalledWith(
      "examAutoCloseWorkflow",
      expect.objectContaining({
        args: [input],
        memo: {
          scheduleRevision: input.scheduleRevision,
          timerFingerprint: input.timerFingerprint,
        },
        taskQueue: "platform",
        workflowId: "exam-auto-close-exam_1",
        workflowIdConflictPolicy: "USE_EXISTING",
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
      }),
    );
  });

  it("does not restart a running matching lifecycle", async () => {
    describeWorkflow.mockResolvedValueOnce(execution());

    await ensureExamAutoClose(input);

    expect(start).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
  });

  it("replaces an older running occurrence by terminating its observed run id", async () => {
    describeWorkflow
      .mockResolvedValueOnce(execution(3, "exam:v1:exam_1:window_a", "RUNNING", "old_run"))
      .mockRejectedValueOnce(
        new WorkflowNotFoundError("not found", "exam-auto-close-exam_1", ""),
      )
      .mockResolvedValueOnce(execution());

    await replaceExamAutoClose(input);

    expect(getHandle).toHaveBeenCalledWith("exam-auto-close-exam_1", "old_run");
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("cancels only the observed matching run", async () => {
    describeWorkflow.mockResolvedValueOnce(execution(3));

    await cancelExamAutoClose(input);

    expect(getHandle).toHaveBeenCalledWith("exam-auto-close-exam_1", "run_1");
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not let stale cancellation stop a newer revision", async () => {
    describeWorkflow.mockResolvedValueOnce(execution(5));

    await cancelExamAutoClose(input);

    expect(terminate).not.toHaveBeenCalled();
  });

  it("re-describes after a start conflict and accepts the winner", async () => {
    describeWorkflow
      .mockRejectedValueOnce(
        new WorkflowNotFoundError("not found", "exam-auto-close-exam_1", ""),
      )
      .mockResolvedValueOnce(execution());
    start.mockRejectedValueOnce(
      new WorkflowExecutionAlreadyStartedError(
        "already started",
        "exam-auto-close-exam_1",
        "examAutoCloseWorkflow",
      ),
    );

    await ensureExamAutoClose(input);

    expect(describeWorkflow).toHaveBeenCalledTimes(2);
    expect(terminate).not.toHaveBeenCalled();
  });
});
