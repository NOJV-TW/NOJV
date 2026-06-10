import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentFindByIdWithCourseId,
  examFindById,
  courseMembershipFindByComposite,
  feedbackUpsert,
  feedbackFindForContext,
  feedbackFindForStudentInContext,
  feedbackFindById,
  feedbackDeleteById,
  feedbackFindExistingForUpsert,
  feedbackAuditCreate,
} = vi.hoisted(() => ({
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  feedbackUpsert: vi.fn(),
  feedbackFindForContext: vi.fn(),
  feedbackFindForStudentInContext: vi.fn(),
  feedbackFindById: vi.fn(),
  feedbackDeleteById: vi.fn(),
  feedbackFindExistingForUpsert: vi.fn(),
  feedbackAuditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
  contestRepo: { findById: vi.fn() },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  submissionFeedbackRepo: {
    upsert: feedbackUpsert,
    findForContext: feedbackFindForContext,
    findForStudentInContext: feedbackFindForStudentInContext,
    findById: feedbackFindById,
    deleteById: feedbackDeleteById,
    findExistingForUpsert: feedbackFindExistingForUpsert,
  },
  submissionFeedbackAuditLogRepo: {
    create: feedbackAuditCreate,
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

import { ConflictError, feedbackDomain, ForbiddenError, NotFoundError } from "@nojv/domain";

const {
  upsertFeedback,
  deleteFeedback,
  listFeedbackForContext,
  getFeedbackForStudent,
  assertCanViewFeedback,
  assertCanWriteFeedback,
} = feedbackDomain;

function actor(
  overrides: Partial<{
    userId: string;
    platformRole: "admin" | "teacher" | "student";
  }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("teacher" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

/** Feedback is a post-close action: gate fixtures need a closed context. */
const CLOSED_AT = new Date("2020-01-01T00:00:00Z");
const OPEN_AT = new Date("2999-01-01T00:00:00Z");

const assignmentContext = { type: "assignment", assignmentId: "ca_hw1" } as const;
const baseInput = {
  studentUserId: "usr_student",
  problemId: "prob_1",
  comment: "Nice solution, but watch the edge cases.",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertFeedback", () => {
  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    feedbackUpsert.mockImplementation((_tx, data) => Promise.resolve({ id: "fb_1", ...data }));
  });

  it("creates then updates the same (student, problem, context) triple as one row", async () => {
    const first = await upsertFeedback(actor({ userId: "usr_t" }), {
      context: assignmentContext,
      input: baseInput,
    });
    const second = await upsertFeedback(actor({ userId: "usr_t" }), {
      context: assignmentContext,
      input: { ...baseInput, comment: "Updated comment after re-grade." },
    });

    // Repo upsert was the write path both times — same uniqueness key, one row.
    expect(feedbackUpsert).toHaveBeenCalledTimes(2);
    const firstData = feedbackUpsert.mock.calls[0]?.[1];
    const secondData = feedbackUpsert.mock.calls[1]?.[1];
    expect(firstData).toMatchObject({
      studentUserId: "usr_student",
      problemId: "prob_1",
      assessmentId: "ca_hw1",
      comment: baseInput.comment,
      authorUserId: "usr_t",
    });
    expect(secondData).toMatchObject({
      studentUserId: "usr_student",
      problemId: "prob_1",
      assessmentId: "ca_hw1",
      comment: "Updated comment after re-grade.",
      authorUserId: "usr_t",
    });
    expect(first.id).toBe("fb_1");
    expect(second.id).toBe("fb_1");
  });

  it("rejects a non-staff actor with ForbiddenError", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      upsertFeedback(actor({ userId: "usr_stu", platformRole: "student" }), {
        context: assignmentContext,
        input: baseInput,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(feedbackUpsert).not.toHaveBeenCalled();
  });

  it("blocks staff while the context is still open", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: OPEN_AT,
    });
    await expect(
      upsertFeedback(actor({ userId: "usr_t" }), {
        context: assignmentContext,
        input: baseInput,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(feedbackUpsert).not.toHaveBeenCalled();
  });
});

describe("deleteFeedback", () => {
  beforeEach(() => {
    feedbackFindById.mockResolvedValue({
      id: "fb_1",
      studentUserId: "usr_student",
      problemId: "prob_1",
      assessmentId: "ca_hw1",
      examId: null,
      comment: "Old comment",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    feedbackDeleteById.mockResolvedValue(undefined);
  });

  it("deletes after asserting permission and close-gate", async () => {
    await deleteFeedback(actor({ userId: "usr_t" }), "fb_1");
    expect(feedbackDeleteById).toHaveBeenCalledTimes(1);
    expect(feedbackDeleteById.mock.calls[0]?.[1]).toBe("fb_1");
  });

  it("throws NotFoundError when the feedback row is missing", async () => {
    feedbackFindById.mockResolvedValue(null);
    await expect(
      deleteFeedback(actor({ userId: "usr_t" }), "fb_missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a non-staff actor with ForbiddenError", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      deleteFeedback(actor({ userId: "usr_stu", platformRole: "student" }), "fb_1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(feedbackDeleteById).not.toHaveBeenCalled();
  });
});

describe("listFeedbackForContext", () => {
  it("returns all rows for staff regardless of close state", async () => {
    feedbackFindForContext.mockResolvedValue([{ id: "fb_1" }, { id: "fb_2" }]);
    const rows = await listFeedbackForContext(assignmentContext);
    expect(rows).toHaveLength(2);
    expect(feedbackFindForContext).toHaveBeenCalledWith({ assessmentId: "ca_hw1" });
  });
});

describe("getFeedbackForStudent", () => {
  it("returns nothing while the context is open, without hitting the repo", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: OPEN_AT,
    });
    const rows = await getFeedbackForStudent("usr_student", assignmentContext);
    expect(rows).toEqual([]);
    expect(feedbackFindForStudentInContext).not.toHaveBeenCalled();
  });

  it("returns rows once the context is closed", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    feedbackFindForStudentInContext.mockResolvedValue([{ id: "fb_1" }]);
    const rows = await getFeedbackForStudent("usr_student", assignmentContext);
    expect(rows).toHaveLength(1);
    expect(feedbackFindForStudentInContext).toHaveBeenCalledWith("usr_student", {
      assessmentId: "ca_hw1",
    });
  });
});

describe("read vs write authorization split", () => {
  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      // OPEN context — closesAt in the far future.
      closesAt: OPEN_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
  });

  it("assertCanViewFeedback does not gate on close — staff GET on an OPEN context succeeds", async () => {
    await expect(
      assertCanViewFeedback(actor({ userId: "usr_t" }), assignmentContext),
    ).resolves.toBeUndefined();
  });

  it("assertCanWriteFeedback still rejects staff on the same OPEN context with ConflictError", async () => {
    await expect(
      assertCanWriteFeedback(actor({ userId: "usr_t" }), assignmentContext),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("assertCanViewFeedback still rejects non-staff with ForbiddenError", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      assertCanViewFeedback(
        actor({ userId: "usr_s", platformRole: "student" }),
        assignmentContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
