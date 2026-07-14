import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueue, dispatchSubmissionJudge, dispatchRejudge } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  dispatchSubmissionJudge: vi.fn(),
  dispatchRejudge: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  durableWorkRepo: {
    enqueue,
    withTx: () => ({ enqueue }),
  },
}));

vi.mock("../../../packages/application/src/shared/orchestration", () => ({
  getDomainOrchestration: () => ({ dispatchSubmissionJudge, dispatchRejudge }),
}));

import {
  REJUDGE_DISPATCH_WORK_KIND,
  SUBMISSION_JUDGE_DISPATCH_WORK_KIND,
  dispatchRejudge as enqueueRejudge,
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
  dispatchSubmissionJudge.mockResolvedValue(undefined);
  dispatchRejudge.mockResolvedValue({ workflowId: "rejudge-fixed" });
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

  it("validates and dispatches a persisted submission work payload", async () => {
    await executeSubmissionJudgeDispatch(job);
    expect(dispatchSubmissionJudge).toHaveBeenCalledWith(job);
  });

  it("persists rejudge work before returning its exact workflow id", async () => {
    const result = await enqueueRejudge({
      mode: "single",
      submissionId: "sub_1",
      triggeredByUserId: "usr_1",
    });
    const work = enqueue.mock.calls[0]?.[0] as {
      kind: string;
      dedupeKey: string;
      payload: { workflowId: string; input: unknown };
    };
    expect(work.kind).toBe(REJUDGE_DISPATCH_WORK_KIND);
    expect(work.dedupeKey).toBe(result.workflowId);
    expect(work.payload.workflowId).toBe(result.workflowId);
    expect(dispatchRejudge).not.toHaveBeenCalled();

    await executeRejudgeDispatch(work.payload);
    expect(dispatchRejudge).toHaveBeenCalledWith(work.payload.input, result.workflowId);
  });
});
