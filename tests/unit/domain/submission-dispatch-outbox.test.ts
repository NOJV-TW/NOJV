import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueue,
  enqueueMany,
  dispatchSubmissionJudge,
  dispatchRejudge,
  listSystemErrorsForRecovery,
} = vi.hoisted(() => ({
  enqueue: vi.fn(),
  enqueueMany: vi.fn(),
  dispatchSubmissionJudge: vi.fn(),
  dispatchRejudge: vi.fn(),
  listSystemErrorsForRecovery: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    enqueue,
    enqueueMany,
    withTx: () => ({ enqueue }),
  },
  submissionRepo: { listSystemErrorsForRecovery },
}));

vi.mock("../../../packages/application/src/shared/orchestration", () => ({
  getDomainOrchestration: () => ({ dispatchSubmissionJudge, dispatchRejudge }),
}));

import {
  SUBMISSION_JUDGE_DISPATCH_WORK_KIND,
  enqueueSubmissionJudgeDispatch,
  executeRejudgeDispatch,
  executeSubmissionJudgeDispatch,
} from "../../../packages/application/src/submission/rejudge-control";

const job = {
  submissionId: "sub_1",
  draft: {
    language: "cpp" as const,
    problemId: "prob_1",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  enqueue.mockResolvedValue({});
  enqueueMany.mockResolvedValue([]);
  dispatchSubmissionJudge.mockResolvedValue(undefined);
  dispatchRejudge.mockResolvedValue({ workflowId: "rejudge-fixed" });
  listSystemErrorsForRecovery.mockResolvedValue([]);
});

describe("submission dispatch outbox", () => {
  it("persists deterministic judge work in the caller transaction without dispatching", async () => {
    const tx = {} as never;
    await enqueueSubmissionJudgeDispatch(tx, job);

    expect(enqueue).toHaveBeenCalledWith({
      kind: SUBMISSION_JUDGE_DISPATCH_WORK_KIND,
      dedupeKey: "sub_1",
      payload: job,
      maxAttempts: 20,
    });
    expect(dispatchSubmissionJudge).not.toHaveBeenCalled();
  });

  it("retires a legacy dispatch without evaluating against live problem data", async () => {
    await executeSubmissionJudgeDispatch(job);
    expect(dispatchSubmissionJudge).not.toHaveBeenCalled();
  });

  it("does not dispatch a legacy automatic rejudge with live problem data", async () => {
    await executeRejudgeDispatch({
      workflowId: "rejudge-system-error-sub_1-1",
      input: {
        mode: "single",
        submissionId: "sub_1",
        triggeredByUserId: null,
        expectedJudgeGeneration: 1,
      },
    });
    expect(dispatchRejudge).not.toHaveBeenCalled();
  });
});
