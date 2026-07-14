import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const { start } = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../../packages/temporal/src/client", () => ({
  getTemporalClient: vi.fn(async () => ({ workflow: { start } })),
}));

import {
  dispatchRejudge,
  dispatchSubmissionJudge,
} from "../../../packages/temporal/src/dispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("durable submission dispatch handlers", () => {
  it("uses the deterministic submission workflow id and accepts duplicate delivery", async () => {
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
      expect.objectContaining({ workflowId: "judge-sub_1" }),
    );
  });

  it("uses the persisted rejudge workflow id and accepts duplicate delivery", async () => {
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
  });
});
