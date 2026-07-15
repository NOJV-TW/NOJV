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
  REJUDGE_DISPATCH_WORK_KIND,
  SUBMISSION_JUDGE_DISPATCH_WORK_KIND,
  dispatchRejudge as enqueueRejudge,
  enqueueSubmissionJudgeDispatch,
  executeRejudgeDispatch,
  executeSubmissionJudgeDispatch,
  recoverSystemErrorSubmissions,
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

  it("enqueues one deterministic system rejudge per failed judge generation", async () => {
    listSystemErrorsForRecovery.mockResolvedValue([
      { id: "sub_1", judgeGeneration: 2 },
      { id: "sub_2", judgeGeneration: 5 },
    ]);

    await expect(recoverSystemErrorSubmissions()).resolves.toBe(2);
    expect(enqueueMany).toHaveBeenCalledWith([
      {
        kind: REJUDGE_DISPATCH_WORK_KIND,
        dedupeKey: "system-error:sub_1:2",
        payload: {
          workflowId: "rejudge-system-error-sub_1-2",
          input: {
            mode: "single",
            submissionId: "sub_1",
            triggeredByUserId: null,
            expectedJudgeGeneration: 2,
          },
        },
        maxAttempts: 20,
      },
      {
        kind: REJUDGE_DISPATCH_WORK_KIND,
        dedupeKey: "system-error:sub_2:5",
        payload: {
          workflowId: "rejudge-system-error-sub_2-5",
          input: {
            mode: "single",
            submissionId: "sub_2",
            triggeredByUserId: null,
            expectedJudgeGeneration: 5,
          },
        },
        maxAttempts: 20,
      },
    ]);
  });
});
