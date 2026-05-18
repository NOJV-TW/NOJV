import { beforeEach, describe, expect, it, vi } from "vitest";

// Repo stubs — hoisted so the vi.mock factory below can reference them.
const {
  assessmentFindById,
  assessmentUpdate,
  assessmentDelete,
  assessmentProblemFindByAssessmentId,
  assessmentProblemDeleteByAssessmentId,
  assessmentProblemCreate,
  courseMembershipFindByComposite,
  problemFindMany,
  problemWorkspaceFindByProblemId,
  assessmentAuditCreate,
} = vi.hoisted(() => ({
  assessmentFindById: vi.fn(),
  assessmentUpdate: vi.fn(),
  assessmentDelete: vi.fn(),
  assessmentProblemFindByAssessmentId: vi.fn(),
  assessmentProblemDeleteByAssessmentId: vi.fn(),
  assessmentProblemCreate: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  problemFindMany: vi.fn(),
  problemWorkspaceFindByProblemId: vi.fn(),
  assessmentAuditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  const assessmentWithTx = {
    findById: assessmentFindById,
    update: assessmentUpdate,
    delete: assessmentDelete,
  };
  const assessmentProblemWithTx = {
    deleteByAssessmentId: assessmentProblemDeleteByAssessmentId,
    create: assessmentProblemCreate,
  };
  const courseMembershipWithTx = {
    findByComposite: courseMembershipFindByComposite,
  };
  const problemWithTx = {
    findMany: problemFindMany,
  };
  return {
    Prisma: {},
    assessmentRepo: {
      withTx: () => assessmentWithTx,
    },
    assessmentProblemRepo: {
      findByAssessmentId: assessmentProblemFindByAssessmentId,
      withTx: () => assessmentProblemWithTx,
    },
    assessmentAuditLogRepo: {
      withTx: () => ({ create: assessmentAuditCreate }),
    },
    courseMembershipRepo: {
      withTx: () => courseMembershipWithTx,
    },
    problemRepo: {
      withTx: () => problemWithTx,
    },
    problemWorkspaceFileRepo: {
      findByProblemId: problemWorkspaceFindByProblemId,
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import { assignmentDomain } from "@nojv/domain";

const {
  updateAssignmentRecord,
  publishAssignment,
  deleteAssignmentDraft,
  revertAssignmentToDraft,
} = assignmentDomain;

const teacherActor = {
  userId: "usr_teacher",
  username: "teacher",
  displayName: "Teacher",
  email: "t@example.com",
  platformRole: "teacher" as const,
};

const studentActor = {
  userId: "usr_student",
  username: "student",
  displayName: "Student",
  email: "s@example.com",
  platformRole: "student" as const,
};

function draftAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: "asg_1",
    courseId: "crs_1",
    createdByUserId: "usr_teacher",
    status: "draft",
    opensAt: new Date("2030-01-01T00:00:00Z"),
    dueAt: new Date("2030-01-10T00:00:00Z"),
    closesAt: new Date("2030-01-15T00:00:00Z"),
    allowedLanguages: ["cpp"],
    title: "Old title",
    ...overrides,
  };
}

describe("updateAssignmentRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentUpdate.mockResolvedValue({ id: "asg_1" });
    assessmentProblemDeleteByAssessmentId.mockResolvedValue({ count: 0 });
    assessmentProblemCreate.mockResolvedValue({});
    problemFindMany.mockResolvedValue([]);
    problemWorkspaceFindByProblemId.mockResolvedValue([]);
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
  });

  it("applies a partial update (title only)", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await updateAssignmentRecord(teacherActor, "asg_1", { title: "New title" });

    expect(assessmentUpdate).toHaveBeenCalledTimes(1);
    const [, data] = assessmentUpdate.mock.calls[0];
    expect(data).toEqual({ title: "New title" });
  });

  it("coerces opensAt / closesAt / dueAt to Date objects", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await updateAssignmentRecord(teacherActor, "asg_1", {
      opensAt: "2031-01-01T00:00:00.000Z",
      closesAt: "2031-02-01T00:00:00.000Z",
      dueAt: "2031-01-20T00:00:00.000Z",
    });

    const [, data] = assessmentUpdate.mock.calls[0];
    expect(data.opensAt).toBeInstanceOf(Date);
    expect(data.closesAt).toBeInstanceOf(Date);
    expect(data.dueAt).toBeInstanceOf(Date);
  });

  it("writes adjustmentRules (late penalty) when provided", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await updateAssignmentRecord(teacherActor, "asg_1", {
      adjustmentRules: [{ type: "flat_late_penalty", penaltyPct: 25, startFrom: "due" }],
    });

    const [, data] = assessmentUpdate.mock.calls[0];
    expect(data.adjustmentRules).toEqual([
      { type: "flat_late_penalty", penaltyPct: 25, startFrom: "due" },
    ]);
  });

  it("clears adjustmentRules when an empty array is sent", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await updateAssignmentRecord(teacherActor, "asg_1", { adjustmentRules: [] });

    const [, data] = assessmentUpdate.mock.calls[0];
    expect(data.adjustmentRules).toEqual([]);
  });

  it("allows dueAt to be nulled out", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await updateAssignmentRecord(teacherActor, "asg_1", { dueAt: null });

    const [, data] = assessmentUpdate.mock.calls[0];
    expect(data.dueAt).toBeNull();
  });

  it("rejects non-course-members", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());
    courseMembershipFindByComposite.mockResolvedValue(null);

    await expect(
      updateAssignmentRecord(studentActor, "asg_1", { title: "hax" }),
    ).rejects.toThrow(/permission/i);
    expect(assessmentUpdate).not.toHaveBeenCalled();
  });

  it("rejects active students (not TA/teacher)", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());
    courseMembershipFindByComposite.mockResolvedValue({
      role: "student",
      status: "active",
    });

    await expect(
      updateAssignmentRecord(studentActor, "asg_1", { title: "hax" }),
    ).rejects.toThrow(/permission/i);
  });

  it("wipes and recreates attach rows when problemIds is provided", async () => {
    // Clear allowedLanguages so the workspace-entry check is skipped
    // (this test isn't about workspace compatibility).
    assessmentFindById.mockResolvedValue(draftAssessment({ allowedLanguages: [] }));
    problemFindMany.mockResolvedValue([{ id: "prob_a" }, { id: "prob_b" }]);

    await updateAssignmentRecord(teacherActor, "asg_1", {
      problemIds: ["prob_a", "prob_b"],
      problemOrdinals: [
        { problemId: "prob_a", points: 50 },
        { problemId: "prob_b", points: 75 },
      ],
    });

    expect(assessmentProblemDeleteByAssessmentId).toHaveBeenCalledWith("asg_1");
    expect(assessmentProblemCreate).toHaveBeenCalledTimes(2);
    const pointsByProblem = new Map(
      assessmentProblemCreate.mock.calls.map((c) => [c[0].problemId, c[0].points]),
    );
    expect(pointsByProblem.get("prob_a")).toBe(50);
    expect(pointsByProblem.get("prob_b")).toBe(75);
  });

  it("blocks changing opensAt once the assignment is open", async () => {
    const now = new Date();
    const opensAt = new Date(now.getTime() - 60_000);
    const closesAt = new Date(now.getTime() + 60_000);
    assessmentFindById.mockResolvedValue(
      draftAssessment({ status: "published", opensAt, closesAt, dueAt: null }),
    );

    await expect(
      updateAssignmentRecord(teacherActor, "asg_1", {
        opensAt: new Date(opensAt.getTime() + 1_000).toISOString(),
      }),
    ).rejects.toThrow(/opensAt/);
  });

  it("refuses to shorten closesAt while open", async () => {
    const now = new Date();
    const opensAt = new Date(now.getTime() - 60_000);
    const closesAt = new Date(now.getTime() + 60_000);
    assessmentFindById.mockResolvedValue(
      draftAssessment({ status: "published", opensAt, closesAt, dueAt: null }),
    );

    await expect(
      updateAssignmentRecord(teacherActor, "asg_1", {
        closesAt: new Date(closesAt.getTime() - 1_000).toISOString(),
      }),
    ).rejects.toThrow(/closesAt/);
  });

  it("rejects any update once the assignment is closed", async () => {
    const now = new Date();
    assessmentFindById.mockResolvedValue(
      draftAssessment({
        status: "published",
        opensAt: new Date(now.getTime() - 120_000),
        closesAt: new Date(now.getTime() - 60_000),
        dueAt: null,
      }),
    );

    await expect(
      updateAssignmentRecord(teacherActor, "asg_1", { title: "nope" }),
    ).rejects.toThrow(/closed/i);
  });
});

describe("publishAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentUpdate.mockResolvedValue({ id: "asg_1" });
    assessmentProblemFindByAssessmentId.mockResolvedValue([
      { id: "pair_1", assessmentId: "asg_1", problemId: "prob_a" },
    ]);
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
  });

  it("promotes a valid draft to published and writes an audit row", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await publishAssignment(teacherActor, "asg_1");

    expect(assessmentUpdate).toHaveBeenCalledWith("asg_1", { status: "published" });
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "asg_1",
      courseId: "crs_1",
      actorUserId: "usr_teacher",
      action: "publish",
    });
  });

  it("blocks non-draft assessments", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ status: "published" }));

    await expect(publishAssignment(teacherActor, "asg_1")).rejects.toThrow(/only draft/i);
    expect(assessmentUpdate).not.toHaveBeenCalled();
  });

  it("requires at least one problem", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());
    assessmentProblemFindByAssessmentId.mockResolvedValue([]);

    await expect(publishAssignment(teacherActor, "asg_1")).rejects.toThrow(
      /at least one problem/i,
    );
  });

  it("requires at least one allowed language", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ allowedLanguages: [] }));

    await expect(publishAssignment(teacherActor, "asg_1")).rejects.toThrow(/language/i);
  });

  it("refuses when closesAt is already in the past", async () => {
    const now = new Date();
    assessmentFindById.mockResolvedValue(
      draftAssessment({
        opensAt: new Date(now.getTime() - 120_000),
        closesAt: new Date(now.getTime() - 60_000),
        dueAt: null,
      }),
    );

    await expect(publishAssignment(teacherActor, "asg_1")).rejects.toThrow(/closesAt/);
  });

  it("refuses when dueAt falls outside [opensAt, closesAt]", async () => {
    const now = new Date();
    assessmentFindById.mockResolvedValue(
      draftAssessment({
        opensAt: new Date(now.getTime() + 60_000),
        dueAt: new Date(now.getTime() + 30_000), // before opensAt
        closesAt: new Date(now.getTime() + 120_000),
      }),
    );

    await expect(publishAssignment(teacherActor, "asg_1")).rejects.toThrow(/dueAt/);
  });

  it("rejects unauthorised callers", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());
    courseMembershipFindByComposite.mockResolvedValue(null);

    await expect(publishAssignment(studentActor, "asg_1")).rejects.toThrow(/permission/i);
  });
});

describe("deleteAssignmentDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentDelete.mockResolvedValue({ id: "asg_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
  });

  it("deletes a draft and writes an audit row", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await deleteAssignmentDraft(teacherActor, "asg_1");

    expect(assessmentDelete).toHaveBeenCalledWith("asg_1");
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "asg_1",
      courseId: "crs_1",
      actorUserId: "usr_teacher",
      action: "delete_draft",
    });
  });

  it("refuses to delete a published assessment", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ status: "published" }));

    await expect(deleteAssignmentDraft(teacherActor, "asg_1")).rejects.toThrow(/only draft/i);
    expect(assessmentDelete).not.toHaveBeenCalled();
  });

  it("refuses to delete an archived assessment", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ status: "archived" }));

    await expect(deleteAssignmentDraft(teacherActor, "asg_1")).rejects.toThrow(/only draft/i);
  });
});

describe("revertAssignmentToDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentUpdate.mockResolvedValue({ id: "asg_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
  });

  it("flips an upcoming published assignment to draft and writes an audit row", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ status: "published" }));

    await revertAssignmentToDraft(teacherActor, "asg_1");

    expect(assessmentUpdate).toHaveBeenCalledWith("asg_1", { status: "draft" });
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "asg_1",
      courseId: "crs_1",
      actorUserId: "usr_teacher",
      action: "revert_to_draft",
    });
  });
});
