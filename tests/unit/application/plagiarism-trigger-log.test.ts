import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  upsertForExam,
  upsertForAssessment,
  upsertForContest,
  findByAssessmentId,
  findByExamId,
  findByContestId,
  triggerLogCreate,
  runTransactionMock,
  activityFindById,
  courseLock,
  courseFindById,
} = vi.hoisted(() => ({
  upsertForExam: vi.fn(),
  upsertForAssessment: vi.fn(),
  upsertForContest: vi.fn(),
  findByAssessmentId: vi.fn(),
  findByExamId: vi.fn(),
  findByContestId: vi.fn(),
  triggerLogCreate: vi.fn(),
  runTransactionMock: vi.fn(),
  activityFindById: vi.fn(),
  courseLock: vi.fn(),
  courseFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  examRepo: { withTx: () => ({ findById: activityFindById }) },
  assessmentRepo: { withTx: () => ({ findById: activityFindById }) },
  courseRepo: { withTx: () => ({ lockForUpdate: courseLock, findById: courseFindById }) },
  contestRepo: {},
  plagiarismRepo: {
    upsertForExam,
    upsertForAssessment,
    upsertForContest,
    findByAssessmentId,
    findByExamId,
    findByContestId,
  },
  plagiarismTriggerLogRepo: { create: triggerLogCreate },
  runTransaction: runTransactionMock,
  assessmentProblemRepo: {},
  submissionRepo: {},
}));

import { plagiarismDomain } from "@nojv/application";

const { createPlagiarismReport } = plagiarismDomain;

const TX_SENTINEL = { __tx: true };

beforeEach(() => {
  upsertForExam.mockReset();
  upsertForAssessment.mockReset();
  upsertForContest.mockReset();
  findByAssessmentId.mockReset();
  findByExamId.mockReset();
  findByContestId.mockReset();
  triggerLogCreate.mockReset();
  runTransactionMock.mockReset();
  runTransactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(TX_SENTINEL),
  );
  activityFindById.mockResolvedValue({ courseId: "crs_1" });
  courseFindById.mockResolvedValue({ id: "crs_1", archived: false });
});

describe("createPlagiarismReport — trigger audit log", () => {
  it("writes a trigger log with priorPairCount=0 when no prior report exists", async () => {
    findByExamId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });

    await createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher");

    expect(triggerLogCreate).toHaveBeenCalledTimes(1);
    const [txArg, data] = triggerLogCreate.mock.calls[0];
    expect(txArg).toBe(TX_SENTINEL);
    expect(data).toEqual({
      contextType: "exam",
      contextId: "exam_1",
      triggeredByUserId: "usr_teacher",
      priorPairCount: 0,
    });
  });

  it("writes priorPairCount=N when prior results contain N pairs", async () => {
    const priorResults = {
      pairs: [
        {
          problemId: "p1",
          userId1: "a",
          userId2: "b",
          similarity: 0.9,
          longest: 10,
          overlap: 20,
        },
        {
          problemId: "p1",
          userId1: "c",
          userId2: "d",
          similarity: 0.8,
          longest: 8,
          overlap: 16,
        },
        {
          problemId: "p2",
          userId1: "e",
          userId2: "f",
          similarity: 0.7,
          longest: 5,
          overlap: 12,
        },
      ],
    };
    findByAssessmentId
      .mockResolvedValueOnce({
        status: "completed",
        results: priorResults,
        reportUrl: "https://moss/x",
        triggeredAt: new Date(),
        completedAt: new Date(),
        triggeredById: "usr_other",
      })
      .mockResolvedValueOnce({ status: "pending" });

    await createPlagiarismReport({ id: "asg_1", type: "assessment" }, "usr_teacher");

    expect(triggerLogCreate).toHaveBeenCalledTimes(1);
    const [, data] = triggerLogCreate.mock.calls[0];
    expect(data.priorPairCount).toBe(3);
  });

  it("treats missing/null results and malformed payloads as priorPairCount=0", async () => {
    findByContestId
      .mockResolvedValueOnce({
        status: "completed",
        results: null,
        reportUrl: null,
        triggeredAt: null,
        completedAt: null,
        triggeredById: null,
      })
      .mockResolvedValueOnce({ status: "pending" });

    await createPlagiarismReport({ id: "ctst_1", type: "contest" }, "usr_teacher");
    expect(triggerLogCreate.mock.calls[0][1].priorPairCount).toBe(0);

    findByContestId.mockReset();
    triggerLogCreate.mockReset();
    findByContestId
      .mockResolvedValueOnce({ status: "completed", results: "garbage" })
      .mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "ctst_2", type: "contest" }, "usr_teacher");
    expect(triggerLogCreate.mock.calls[0][1].priorPairCount).toBe(0);

    findByContestId.mockReset();
    triggerLogCreate.mockReset();
    findByContestId
      .mockResolvedValueOnce({ status: "completed", results: { pairs: "not-an-array" } })
      .mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "ctst_3", type: "contest" }, "usr_teacher");
    expect(triggerLogCreate.mock.calls[0][1].priorPairCount).toBe(0);
  });

  it("maps assessment target to contextType='assessment'", async () => {
    findByAssessmentId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "asg_42", type: "assessment" }, "usr_t");
    expect(triggerLogCreate.mock.calls[0][1]).toMatchObject({
      contextType: "assessment",
      contextId: "asg_42",
    });
  });

  it("maps exam target to contextType='exam'", async () => {
    findByExamId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "exam_42", type: "exam" }, "usr_t");
    expect(triggerLogCreate.mock.calls[0][1]).toMatchObject({
      contextType: "exam",
      contextId: "exam_42",
    });
  });

  it("maps contest target to contextType='contest'", async () => {
    findByContestId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "ctst_42", type: "contest" }, "usr_t");
    expect(triggerLogCreate.mock.calls[0][1]).toMatchObject({
      contextType: "contest",
      contextId: "ctst_42",
    });
  });

  it("passes triggeredByUserId verbatim from input", async () => {
    findByExamId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });
    await createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_specific_actor");
    expect(triggerLogCreate.mock.calls[0][1].triggeredByUserId).toBe("usr_specific_actor");
  });

  it("writes the trigger log BEFORE the parent-row overwrite", async () => {
    const order: string[] = [];
    findByExamId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });
    triggerLogCreate.mockImplementation(() => {
      order.push("trigger-log");
    });
    upsertForExam.mockImplementation(() => {
      order.push("upsert");
    });

    await createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher");

    expect(order).toEqual(["trigger-log", "upsert"]);
  });

  it("writes the trigger log and the parent-row overwrite in one transaction", async () => {
    findByExamId.mockResolvedValueOnce(null).mockResolvedValueOnce({ status: "pending" });

    await createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher");

    expect(runTransactionMock).toHaveBeenCalledOnce();
    expect(triggerLogCreate.mock.calls[0][0]).toBe(TX_SENTINEL);
    expect(upsertForExam.mock.calls[0][2]).toBe(TX_SENTINEL);
  });

  it("rejects an archived course before writing the receipt or wiping results", async () => {
    findByAssessmentId.mockResolvedValueOnce({ status: "completed", results: { pairs: [] } });
    courseFindById.mockResolvedValue({ id: "crs_1", archived: true });

    await expect(
      createPlagiarismReport({ id: "asg_1", type: "assessment" }, "usr_teacher"),
    ).rejects.toMatchObject({
      name: "ValidationError",
      message: "Archived courses are read-only.",
    });

    expect(courseLock).toHaveBeenCalledWith("crs_1");
    expect(triggerLogCreate).not.toHaveBeenCalled();
    expect(upsertForAssessment).not.toHaveBeenCalled();
  });

  it("does NOT write a trigger log if the tx itself fails", async () => {
    findByExamId.mockResolvedValueOnce(null);
    runTransactionMock.mockRejectedValueOnce(new Error("tx aborted"));

    await expect(
      createPlagiarismReport({ id: "exam_1", type: "exam" }, "usr_teacher"),
    ).rejects.toThrow("tx aborted");

    expect(upsertForExam).not.toHaveBeenCalled();
  });
});
