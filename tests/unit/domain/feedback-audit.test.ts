import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentFindByIdWithCourseId,
  examFindById,
  courseMembershipFindByComposite,
  feedbackUpsert,
  feedbackFindExistingForUpsert,
  feedbackFindById,
  feedbackDeleteById,
  auditCreate,
} = vi.hoisted(() => ({
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  feedbackUpsert: vi.fn(),
  feedbackFindExistingForUpsert: vi.fn(),
  feedbackFindById: vi.fn(),
  feedbackDeleteById: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
  contestRepo: { findById: vi.fn() },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  submissionFeedbackRepo: {
    upsert: feedbackUpsert,
    findForContext: vi.fn(),
    findForStudentInContext: vi.fn(),
    findById: feedbackFindById,
    deleteById: feedbackDeleteById,
    findExistingForUpsert: feedbackFindExistingForUpsert,
  },
  submissionFeedbackAuditLogRepo: {
    create: auditCreate,
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

import { feedbackDomain } from "@nojv/domain";

const { upsertFeedback, deleteFeedback } = feedbackDomain;

function actor(userId = "usr_actor") {
  return {
    userId,
    username: "actor",
    platformRole: "teacher" as const,
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const CLOSED_AT = new Date("2020-01-01T00:00:00Z");

const assignmentContext = { type: "assignment", assignmentId: "ca_hw1" } as const;
const examContext = { type: "exam", examId: "ex_mid" } as const;
const baseInput = {
  studentUserId: "usr_student",
  problemId: "prob_1",
  comment: "Nice solution, but watch the edge cases.",
};

type AuditCall = {
  feedbackId: string | null;
  studentUserId: string;
  problemId: string;
  assessmentId: string | null;
  examId: string | null;
  action: "create" | "update" | "delete";
  oldComment: string | null;
  newComment: string | null;
  changedByUserId: string | null;
};

beforeEach(() => {
  vi.clearAllMocks();
  assessmentFindByIdWithCourseId.mockResolvedValue({
    id: "ca_hw1",
    courseId: "crs_1",
    closesAt: CLOSED_AT,
  });
  examFindById.mockResolvedValue({
    id: "ex_mid",
    courseId: "crs_1",
    endsAt: CLOSED_AT,
  });
  courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
  feedbackUpsert.mockImplementation((_tx, data) => Promise.resolve({ id: "fb_1", ...data }));
  auditCreate.mockResolvedValue({});
});

describe("upsertFeedback audit trail", () => {
  it("writes a create audit row when no prior row exists", async () => {
    feedbackFindExistingForUpsert.mockResolvedValue(null);

    await upsertFeedback(actor("usr_t"), { context: assignmentContext, input: baseInput });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const call = auditCreate.mock.calls[0]?.[1] as AuditCall;
    expect(call.action).toBe("create");
    expect(call.feedbackId).toBe("fb_1");
    expect(call.studentUserId).toBe("usr_student");
    expect(call.problemId).toBe("prob_1");
    expect(call.assessmentId).toBe("ca_hw1");
    expect(call.examId).toBeNull();
    expect(call.oldComment).toBeNull();
    expect(call.newComment).toBe(baseInput.comment);
    expect(call.changedByUserId).toBe("usr_t");
  });

  it("writes an update audit row with the prior comment when a row already exists", async () => {
    feedbackFindExistingForUpsert.mockResolvedValue({
      id: "fb_1",
      comment: "Old comment from last week",
    });

    await upsertFeedback(actor("usr_t"), {
      context: assignmentContext,
      input: { ...baseInput, comment: "Updated comment after re-grade." },
    });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const call = auditCreate.mock.calls[0]?.[1] as AuditCall;
    expect(call.action).toBe("update");
    expect(call.feedbackId).toBe("fb_1");
    expect(call.oldComment).toBe("Old comment from last week");
    expect(call.newComment).toBe("Updated comment after re-grade.");
    expect(call.changedByUserId).toBe("usr_t");
  });

  it("records idempotent edits (same comment) as an update row anyway", async () => {
    feedbackFindExistingForUpsert.mockResolvedValue({
      id: "fb_1",
      comment: baseInput.comment,
    });

    await upsertFeedback(actor("usr_t"), { context: assignmentContext, input: baseInput });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const call = auditCreate.mock.calls[0]?.[1] as AuditCall;
    expect(call.action).toBe("update");
    expect(call.oldComment).toBe(baseInput.comment);
    expect(call.newComment).toBe(baseInput.comment);
  });

  it("routes exam-context fields onto examId, leaving assessmentId null", async () => {
    feedbackFindExistingForUpsert.mockResolvedValue(null);

    await upsertFeedback(actor("usr_t"), { context: examContext, input: baseInput });

    const call = auditCreate.mock.calls[0]?.[1] as AuditCall;
    expect(call.examId).toBe("ex_mid");
    expect(call.assessmentId).toBeNull();
    expect(call.action).toBe("create");
  });
});

describe("deleteFeedback audit trail", () => {
  beforeEach(() => {
    feedbackFindById.mockResolvedValue({
      id: "fb_1",
      studentUserId: "usr_student",
      problemId: "prob_1",
      assessmentId: "ca_hw1",
      examId: null,
      comment: "Old comment",
    });
    feedbackDeleteById.mockResolvedValue(undefined);
  });

  it("writes a delete audit row with feedbackId still set to the existing row", async () => {
    await deleteFeedback(actor("usr_t"), "fb_1");

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const call = auditCreate.mock.calls[0]?.[1] as AuditCall;
    expect(call.action).toBe("delete");
    expect(call.feedbackId).toBe("fb_1");
    expect(call.studentUserId).toBe("usr_student");
    expect(call.problemId).toBe("prob_1");
    expect(call.assessmentId).toBe("ca_hw1");
    expect(call.examId).toBeNull();
    expect(call.oldComment).toBe("Old comment");
    expect(call.newComment).toBeNull();
    expect(call.changedByUserId).toBe("usr_t");
  });

  it("writes the audit row BEFORE the actual delete so the FK is still valid", async () => {
    const order: string[] = [];
    auditCreate.mockImplementation(() => {
      order.push("audit");
      return Promise.resolve({});
    });
    feedbackDeleteById.mockImplementation(() => {
      order.push("delete");
      return Promise.resolve(undefined);
    });

    await deleteFeedback(actor("usr_t"), "fb_1");

    expect(order).toEqual(["audit", "delete"]);
  });
});
