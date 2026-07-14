import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assessmentFindById,
  assessmentLockForUpdate,
  assessmentUpdate,
  assessmentDelete,
  assessmentProblemFindByAssessmentId,
  assessmentProblemDeleteByAssessmentId,
  assessmentProblemCreate,
  courseMembershipFindByComposite,
  problemFindMany,
  problemWorkspaceFindByProblemId,
  testcaseSetFindByProblemId,
  assessmentAuditCreate,
} = vi.hoisted(() => ({
  assessmentFindById: vi.fn(),
  assessmentLockForUpdate: vi.fn(),
  assessmentUpdate: vi.fn(),
  assessmentDelete: vi.fn(),
  assessmentProblemFindByAssessmentId: vi.fn(),
  assessmentProblemDeleteByAssessmentId: vi.fn(),
  assessmentProblemCreate: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  problemFindMany: vi.fn(),
  problemWorkspaceFindByProblemId: vi.fn(),
  testcaseSetFindByProblemId: vi.fn(),
  assessmentAuditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => {
  const assessmentWithTx = {
    findById: assessmentFindById,
    lockForUpdate: assessmentLockForUpdate,
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
    testcaseSetRepo: {
      withTx: () => ({ findByProblemId: testcaseSetFindByProblemId }),
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
  };
});

import { assignmentDomain, configureDomainOrchestration } from "@nojv/application";

const {
  updateAssignmentRecord,
  publishAssignment,
  deleteAssignmentDraft,
  revertAssignmentToDraft,
} = assignmentDomain;

const ensureAssignmentDueSoon = vi.fn(async () => {});
const replaceAssignmentDueSoon = vi.fn(async () => {});
const cancelAssignmentDueSoon = vi.fn(async () => {});

beforeEach(() => {
  configureDomainOrchestration({
    cancelAssignmentDueSoon,
    cancelContestLifecycle: vi.fn(async () => {}),
    cancelExamAutoClose: vi.fn(async () => {}),
    cancelRejudge: vi.fn(async () => {}),
    describeSubmissionJudge: vi.fn(async () => null),
    dispatchPlagiarismCheck: vi.fn(async () => {}),
    dispatchRegistryGarbageCollect: vi.fn(async () => ({
      workflowId: "registry-gc",
      alreadyRunning: false,
    })),
    dispatchRejudge: vi.fn(async () => ({ workflowId: "rejudge-test" })),
    dispatchSubmissionJudge: vi.fn(async () => {}),
    ensureAssignmentDueSoon,
    ensureContestLifecycle: vi.fn(async () => {}),
    ensureExamAutoClose: vi.fn(async () => {}),
    getRejudgeTriggeredBy: vi.fn(async () => null),
    probeTemporal: vi.fn(async () => {}),
    queryRejudgeProgress: vi.fn(async () => ({ completed: 0, total: 0 })),
    replaceAssignmentDueSoon,
    replaceContestLifecycle: vi.fn(async () => {}),
    replaceExamAutoClose: vi.fn(async () => {}),
    terminateSubmissionJudge: vi.fn(async () => {}),
  });
});

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
    scheduleRevision: 1,
    timerFingerprint: "assessment:v1:asg_1:window_a",
    ...overrides,
  };
}

describe("updateAssignmentRecord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...draftAssessment(),
      ...data,
    }));
    assessmentLockForUpdate.mockResolvedValue([]);
    assessmentProblemDeleteByAssessmentId.mockResolvedValue({ count: 0 });
    assessmentProblemCreate.mockResolvedValue({});
    problemFindMany.mockResolvedValue([]);
    problemWorkspaceFindByProblemId.mockResolvedValue([]);
    testcaseSetFindByProblemId.mockResolvedValue([]);
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

  it("stores each problem's total (Σ subtask weight) as its max", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ allowedLanguages: [] }));
    problemFindMany.mockResolvedValue([
      { id: "prob_a", type: "full_source" },
      { id: "prob_b", type: "full_source" },
    ]);
    testcaseSetFindByProblemId.mockImplementation(async (problemId: string) => {
      if (problemId === "prob_a") return [{ weight: 40 }, { weight: 80 }];
      if (problemId === "prob_b") return [{ weight: 200 }];
      return [];
    });

    await updateAssignmentRecord(teacherActor, "asg_1", {
      problemIds: ["prob_a", "prob_b"],
    });

    expect(assessmentProblemDeleteByAssessmentId).toHaveBeenCalledWith("asg_1");
    expect(assessmentProblemCreate).toHaveBeenCalledTimes(2);
    const pointsByProblem = new Map(
      assessmentProblemCreate.mock.calls.map((c) => [c[0].problemId, c[0].points]),
    );
    expect(pointsByProblem.get("prob_a")).toBe(120);
    expect(pointsByProblem.get("prob_b")).toBe(200);
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

  it("locks, re-reads, and rejects a close that conflicts with the persisted due date", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await expect(
      updateAssignmentRecord(teacherActor, "asg_1", {
        closesAt: "2030-01-05T00:00:00.000Z",
      }),
    ).rejects.toThrow(/closesAt/);

    expect(assessmentLockForUpdate).toHaveBeenCalledWith("asg_1");
    expect(assessmentLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      assessmentFindById.mock.invocationCallOrder[0],
    );
    expect(assessmentUpdate).not.toHaveBeenCalled();
  });

  it("replaces the lifecycle only when a published timer actually changes", async () => {
    const published = draftAssessment({ status: "published" });
    const closesAt = new Date("2030-01-20T00:00:00.000Z");
    assessmentFindById.mockResolvedValue(published);
    assessmentUpdate.mockResolvedValue({
      ...published,
      closesAt,
      scheduleRevision: 2,
      timerFingerprint: "assessment:v1:asg_1:window_b",
    });

    await updateAssignmentRecord(teacherActor, "asg_1", {
      closesAt: closesAt.toISOString(),
    });

    expect(replaceAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "asg_1",
        scheduleRevision: 2,
        timerFingerprint: "assessment:v1:asg_1:window_b",
      }),
    );
  });
});

describe("publishAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assessmentUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...draftAssessment(),
      ...data,
      scheduleRevision: 2,
    }));
    assessmentProblemFindByAssessmentId.mockResolvedValue([
      { id: "pair_1", assessmentId: "asg_1", problemId: "prob_a" },
    ]);
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
    assessmentLockForUpdate.mockResolvedValue([]);
  });

  it("promotes a valid draft to published and writes an audit row", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment());

    await publishAssignment(teacherActor, "asg_1");

    expect(assessmentLockForUpdate).toHaveBeenCalledWith("asg_1");
    expect(assessmentLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      assessmentFindById.mock.invocationCallOrder[0],
    );
    expect(assessmentUpdate).toHaveBeenCalledWith("asg_1", { status: "published" });
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "asg_1",
      courseId: "crs_1",
      actorUserId: "usr_teacher",
      action: "publish",
    });
    expect(ensureAssignmentDueSoon).toHaveBeenCalledWith({
      assignmentId: "asg_1",
      opensAt: new Date("2030-01-01T00:00:00Z").toISOString(),
      closesAt: new Date("2030-01-15T00:00:00Z").toISOString(),
      scheduleRevision: 2,
      timerFingerprint: "assessment:v1:asg_1:window_a",
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
    expect(assessmentLockForUpdate).toHaveBeenCalledWith("asg_1");
    expect(cancelAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: "asg_1",
        scheduleRevision: 1,
        timerFingerprint: "assessment:v1:asg_1:window_a",
      }),
    );
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
    assessmentUpdate.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...draftAssessment({ status: "published" }),
      ...data,
      scheduleRevision: 2,
    }));
    assessmentLockForUpdate.mockResolvedValue([]);
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
  });

  it("flips an upcoming published assignment to draft and writes an audit row", async () => {
    assessmentFindById.mockResolvedValue(draftAssessment({ status: "published" }));

    await revertAssignmentToDraft(teacherActor, "asg_1");

    expect(assessmentLockForUpdate).toHaveBeenCalledWith("asg_1");
    expect(assessmentLockForUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      assessmentFindById.mock.invocationCallOrder[0],
    );
    expect(assessmentUpdate).toHaveBeenCalledWith("asg_1", { status: "draft" });
    expect(assessmentAuditCreate).toHaveBeenCalledWith({
      assessmentId: "asg_1",
      courseId: "crs_1",
      actorUserId: "usr_teacher",
      action: "revert_to_draft",
    });
    expect(cancelAssignmentDueSoon).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: "asg_1", scheduleRevision: 2 }),
    );
  });
});
