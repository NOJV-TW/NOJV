import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueue, dispatchJudgeExecution } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  dispatchJudgeExecution: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    enqueue,
    withTx: () => ({ enqueue }),
  },
}));

vi.mock("../../../packages/application/src/shared/orchestration", () => ({
  getDomainOrchestration: () => ({ dispatchJudgeExecution }),
}));

import {
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
});

describe("legacy dispatch work drain", () => {
  it("retires a legacy dispatch without evaluating against live problem data", async () => {
    await executeSubmissionJudgeDispatch(job);
    expect(dispatchJudgeExecution).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
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
    expect(dispatchJudgeExecution).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
