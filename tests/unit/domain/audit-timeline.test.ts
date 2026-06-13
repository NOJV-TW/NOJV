import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentAuditListByAssessment,
  scoreOverrideAuditListForContext,
  rejudgeListForSubmissionIds,
  submissionListIdsForContext,
} = vi.hoisted(() => ({
  assessmentAuditListByAssessment: vi.fn(),
  scoreOverrideAuditListForContext: vi.fn(),
  rejudgeListForSubmissionIds: vi.fn(),
  submissionListIdsForContext: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentAuditLogRepo: { listByAssessment: assessmentAuditListByAssessment },
  scoreOverrideAuditLogRepo: { listForContext: scoreOverrideAuditListForContext },
  submissionRejudgeLogRepo: { listForSubmissionIds: rejudgeListForSubmissionIds },
  submissionRepo: { listIdsForContext: submissionListIdsForContext },
}));

import { auditDomain } from "@nojv/application";

const { listAuditTimelineForContext } = auditDomain;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAuditTimelineForContext", () => {
  it("assignment: merges lifecycle, score-override and rejudge events into one reverse-chronological array", async () => {
    assessmentAuditListByAssessment.mockResolvedValue([
      {
        createdAt: new Date("2026-01-01T10:00:00Z"),
        actorUserId: "usr_teacher",
        action: "published",
      },
    ]);
    scoreOverrideAuditListForContext.mockResolvedValue([
      {
        createdAt: new Date("2026-01-03T10:00:00Z"),
        changedByUserId: "usr_ta",
        action: "update",
        userId: "usr_student",
        problemId: "prob_1",
        oldScore: 50,
        newScore: 80,
        oldReason: "old",
        newReason: "new",
      },
    ]);
    submissionListIdsForContext.mockResolvedValue(["sub_1", "sub_2"]);
    rejudgeListForSubmissionIds.mockResolvedValue([
      {
        createdAt: new Date("2026-01-02T10:00:00Z"),
        submissionId: "sub_1",
        rejudgedByUserId: "usr_teacher",
        oldVerdict: "wrong_answer",
        newVerdict: "accepted",
        oldScore: 0,
        newScore: 100,
      },
    ]);

    const timeline = await listAuditTimelineForContext({
      type: "assignment",
      assignmentId: "ca_1",
    });

    expect(timeline).toHaveLength(3);
    expect(timeline.map((e) => e.kind)).toEqual(["score_override", "rejudge", "lifecycle"]);
    expect(timeline.map((e) => e.at.toISOString())).toEqual([
      "2026-01-03T10:00:00.000Z",
      "2026-01-02T10:00:00.000Z",
      "2026-01-01T10:00:00.000Z",
    ]);

    expect(timeline[2]).toEqual({
      at: new Date("2026-01-01T10:00:00Z"),
      actorUserId: "usr_teacher",
      kind: "lifecycle",
      detail: { action: "published" },
    });

    expect(timeline[0]).toEqual({
      at: new Date("2026-01-03T10:00:00Z"),
      actorUserId: "usr_ta",
      kind: "score_override",
      detail: {
        action: "update",
        userId: "usr_student",
        problemId: "prob_1",
        oldScore: 50,
        newScore: 80,
        oldReason: "old",
        newReason: "new",
      },
    });

    expect(timeline[1]).toEqual({
      at: new Date("2026-01-02T10:00:00Z"),
      actorUserId: "usr_teacher",
      kind: "rejudge",
      detail: {
        submissionId: "sub_1",
        oldVerdict: "wrong_answer",
        newVerdict: "accepted",
        oldScore: 0,
        newScore: 100,
      },
    });

    expect(assessmentAuditListByAssessment).toHaveBeenCalledWith("ca_1");
    expect(scoreOverrideAuditListForContext).toHaveBeenCalledWith("assignment", "ca_1");
    expect(submissionListIdsForContext).toHaveBeenCalledWith({
      type: "assignment",
      assignmentId: "ca_1",
    });
    expect(rejudgeListForSubmissionIds).toHaveBeenCalledWith(["sub_1", "sub_2"]);
  });

  it("exam: omits lifecycle events — only score-override + rejudge", async () => {
    scoreOverrideAuditListForContext.mockResolvedValue([
      {
        createdAt: new Date("2026-02-02T10:00:00Z"),
        changedByUserId: "usr_ta",
        action: "create",
        userId: "usr_student",
        problemId: "prob_1",
        oldScore: null,
        newScore: 90,
        oldReason: null,
        newReason: "bonus",
      },
    ]);
    submissionListIdsForContext.mockResolvedValue(["sub_9"]);
    rejudgeListForSubmissionIds.mockResolvedValue([
      {
        createdAt: new Date("2026-02-01T10:00:00Z"),
        submissionId: "sub_9",
        rejudgedByUserId: null,
        oldVerdict: "runtime_error",
        newVerdict: "accepted",
        oldScore: 0,
        newScore: 100,
      },
    ]);

    const timeline = await listAuditTimelineForContext({ type: "exam", examId: "e_1" });

    expect(assessmentAuditListByAssessment).not.toHaveBeenCalled();
    expect(timeline.map((e) => e.kind)).toEqual(["score_override", "rejudge"]);
    expect(scoreOverrideAuditListForContext).toHaveBeenCalledWith("exam", "e_1");
  });

  it("contest: omits lifecycle events — only score-override + rejudge", async () => {
    scoreOverrideAuditListForContext.mockResolvedValue([]);
    submissionListIdsForContext.mockResolvedValue([]);
    rejudgeListForSubmissionIds.mockResolvedValue([]);

    const timeline = await listAuditTimelineForContext({ type: "contest", contestId: "c_1" });

    expect(assessmentAuditListByAssessment).not.toHaveBeenCalled();
    expect(scoreOverrideAuditListForContext).toHaveBeenCalledWith("contest", "c_1");
    expect(timeline).toEqual([]);
  });

  it("skips the rejudge query when the context has no submissions", async () => {
    scoreOverrideAuditListForContext.mockResolvedValue([]);
    submissionListIdsForContext.mockResolvedValue([]);
    rejudgeListForSubmissionIds.mockResolvedValue([]);

    await listAuditTimelineForContext({ type: "contest", contestId: "c_empty" });

    expect(rejudgeListForSubmissionIds).toHaveBeenCalledWith([]);
  });
});
