import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  contestFindInfoById,
  assessmentFindByIdWithCourseId,
  examFindById,
  examFindInfoById,
  courseMembershipFindByComposite,
  overrideCreate,
  overrideUpdate,
  overrideDelete,
  overrideFindById,
  auditCreate,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  contestFindInfoById: vi.fn(() => Promise.resolve({ scoringMode: "point_sum" })),
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  examFindInfoById: vi.fn(() => Promise.resolve({ scoringMode: "point_sum" })),
  courseMembershipFindByComposite: vi.fn(),
  overrideCreate: vi.fn(),
  overrideUpdate: vi.fn(),
  overrideDelete: vi.fn(),
  overrideFindById: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById, findInfoById: contestFindInfoById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById, findInfoById: examFindInfoById },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  contestParticipationRepo: { findIdByContestAndUser: vi.fn(() => Promise.resolve(null)) },
  examParticipationRepo: { findIdByExamAndUser: vi.fn(() => Promise.resolve(null)) },
  scoreOverrideRepo: {
    create: overrideCreate,
    update: overrideUpdate,
    delete: overrideDelete,
    findById: overrideFindById,
  },
  scoreOverrideAuditLogRepo: {
    create: auditCreate,
  },
  runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({}),
}));

import { ConflictError, ForbiddenError, ValidationError, NotFoundError } from "@nojv/domain";
import { scoreOverrideDomain } from "@nojv/domain";

const {
  createOverride,
  updateOverride,
  deleteOverride,
  canSetScoreOverride,
  assertCanViewScoreOverrides,
  assertCanSetScoreOverride,
} = scoreOverrideDomain;

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

const baseInput = {
  userId: "usr_student",
  problemId: "prob_1",
  context: { type: "assignment", assignmentId: "ca_hw1" } as const,
  overrideScore: 80,
  reason: "Manual adjustment after grading dispute.",
};

/** Score overrides are a post-close action: gate fixtures need a closed context. */
const CLOSED_AT = new Date("2020-01-01T00:00:00Z");
const OPEN_AT = new Date("2999-01-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canSetScoreOverride", () => {
  it("admin is always permitted", async () => {
    expect(
      await canSetScoreOverride(actor({ platformRole: "admin" }), {
        type: "assignment",
        assignmentId: "ca_hw1",
      }),
    ).toBe(true);
    expect(
      await canSetScoreOverride(actor({ platformRole: "admin" }), {
        type: "contest",
        contestId: "c_1",
      }),
    ).toBe(true);
    expect(
      await canSetScoreOverride(actor({ platformRole: "admin" }), {
        type: "exam",
        examId: "e_1",
      }),
    ).toBe(true);
  });

  it("contest: only organizer allowed", async () => {
    contestFindById.mockResolvedValue({ id: "c_1", createdByUserId: "usr_org" });
    expect(
      await canSetScoreOverride(actor({ userId: "usr_org" }), {
        type: "contest",
        contestId: "c_1",
      }),
    ).toBe(true);
    expect(
      await canSetScoreOverride(actor({ userId: "usr_other" }), {
        type: "contest",
        contestId: "c_1",
      }),
    ).toBe(false);
  });

  it("assignment: only course teacher/TA allowed", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      role: "teacher",
      status: "active",
    });
    expect(
      await canSetScoreOverride(actor({ userId: "usr_t" }), {
        type: "assignment",
        assignmentId: "ca_1",
      }),
    ).toBe(true);

    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    expect(
      await canSetScoreOverride(actor({ userId: "usr_s" }), {
        type: "assignment",
        assignmentId: "ca_1",
      }),
    ).toBe(false);

    courseMembershipFindByComposite.mockResolvedValue({ role: "ta", status: "active" });
    expect(
      await canSetScoreOverride(actor({ userId: "usr_ta" }), {
        type: "assignment",
        assignmentId: "ca_1",
      }),
    ).toBe(true);
  });

  it("exam: only course teacher/TA allowed", async () => {
    examFindById.mockResolvedValue({ id: "e_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    expect(
      await canSetScoreOverride(actor({ userId: "usr_t" }), { type: "exam", examId: "e_1" }),
    ).toBe(true);

    courseMembershipFindByComposite.mockResolvedValue(null);
    expect(
      await canSetScoreOverride(actor({ userId: "usr_other", platformRole: "teacher" }), {
        type: "exam",
        examId: "e_1",
      }),
    ).toBe(false);
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

  const openContext = { type: "assignment", assignmentId: "ca_hw1" } as const;

  it("assertCanViewScoreOverrides does not gate on close — staff GET on an OPEN context succeeds", async () => {
    await expect(
      assertCanViewScoreOverrides(actor({ userId: "usr_t" }), openContext),
    ).resolves.toBeUndefined();
  });

  it("assertCanSetScoreOverride still rejects staff on the same OPEN context with ConflictError", async () => {
    await expect(
      assertCanSetScoreOverride(actor({ userId: "usr_t" }), openContext),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("assertCanViewScoreOverrides still rejects non-staff with ForbiddenError", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      assertCanViewScoreOverrides(
        actor({ userId: "usr_s", platformRole: "student" }),
        openContext,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createOverride", () => {
  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    overrideCreate.mockResolvedValue({ id: "ov_1" });
    auditCreate.mockResolvedValue({});
  });

  it("writes both the override and the audit row", async () => {
    await createOverride(actor({ userId: "usr_t" }), baseInput);

    expect(overrideCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    const auditCall = auditCreate.mock.calls[0]?.[1] as {
      action: string;
      oldScore: number | null;
      newScore: number | null;
      oldReason: string | null;
      newReason: string | null;
      overrideId: string | null;
    };
    expect(auditCall.action).toBe("create");
    expect(auditCall.oldScore).toBeNull();
    expect(auditCall.newScore).toBe(80);
    expect(auditCall.oldReason).toBeNull();
    expect(auditCall.newReason).toBe(baseInput.reason);
    expect(auditCall.overrideId).toBe("ov_1");
  });

  it("rejects an empty reason", async () => {
    await expect(
      createOverride(actor({ userId: "usr_t" }), { ...baseInput, reason: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(overrideCreate).not.toHaveBeenCalled();
  });

  it("rejects a reason over 500 characters", async () => {
    await expect(
      createOverride(actor({ userId: "usr_t" }), { ...baseInput, reason: "x".repeat(501) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a negative score", async () => {
    await expect(
      createOverride(actor({ userId: "usr_t" }), { ...baseInput, overrideScore: -1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-integer score", async () => {
    await expect(
      createOverride(actor({ userId: "usr_t" }), { ...baseInput, overrideScore: 1.5 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an override on an ICPC (problem_count) contest with ValidationError", async () => {
    contestFindInfoById.mockResolvedValue({ scoringMode: "problem_count" });
    await expect(
      createOverride(actor({ userId: "usr_admin", platformRole: "admin" }), {
        ...baseInput,
        context: { type: "contest", contestId: "c_1" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(overrideCreate).not.toHaveBeenCalled();
  });

  it("rejects an override on an ICPC (problem_count) exam with ValidationError", async () => {
    examFindInfoById.mockResolvedValue({ scoringMode: "problem_count" });
    await expect(
      createOverride(actor({ userId: "usr_admin", platformRole: "admin" }), {
        ...baseInput,
        context: { type: "exam", examId: "e_1" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(overrideCreate).not.toHaveBeenCalled();
  });

  it("allows an override on a point-sum (IOI) contest", async () => {
    contestFindInfoById.mockResolvedValue({ scoringMode: "point_sum" });
    await createOverride(actor({ userId: "usr_admin", platformRole: "admin" }), {
      ...baseInput,
      context: { type: "contest", contestId: "c_1" },
    });
    expect(overrideCreate).toHaveBeenCalledTimes(1);
  });

  it("denies non-staff non-admin callers", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      createOverride(actor({ userId: "usr_stu", platformRole: "student" }), baseInput),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(overrideCreate).not.toHaveBeenCalled();
  });

  it("blocks staff while the context is still open", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: OPEN_AT,
    });
    await expect(createOverride(actor({ userId: "usr_t" }), baseInput)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(overrideCreate).not.toHaveBeenCalled();
  });

  it("allows an admin to override even while the context is open", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: OPEN_AT,
    });
    await createOverride(actor({ userId: "usr_admin", platformRole: "admin" }), baseInput);
    expect(overrideCreate).toHaveBeenCalledTimes(1);
  });
});

describe("updateOverride", () => {
  beforeEach(() => {
    overrideFindById.mockResolvedValue({
      id: "ov_1",
      userId: "usr_student",
      problemId: "prob_1",
      contextType: "assignment",
      contextId: "ca_hw1",
      overrideScore: 80,
      reason: "Old reason",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    overrideUpdate.mockResolvedValue({
      id: "ov_1",
      overrideScore: 95,
      reason: "New reason",
    });
    auditCreate.mockResolvedValue({});
  });

  it("writes an audit row with before/after values", async () => {
    await updateOverride(actor({ userId: "usr_t" }), "ov_1", {
      overrideScore: 95,
      reason: "New reason",
    });

    expect(overrideUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    const auditCall = auditCreate.mock.calls[0]?.[1] as {
      action: string;
      oldScore: number | null;
      newScore: number | null;
      oldReason: string | null;
      newReason: string | null;
      overrideId: string | null;
    };
    expect(auditCall.action).toBe("update");
    expect(auditCall.oldScore).toBe(80);
    expect(auditCall.newScore).toBe(95);
    expect(auditCall.oldReason).toBe("Old reason");
    expect(auditCall.newReason).toBe("New reason");
    expect(auditCall.overrideId).toBe("ov_1");
  });

  it("throws NotFoundError when the override is missing", async () => {
    overrideFindById.mockResolvedValue(null);
    await expect(
      updateOverride(actor({ userId: "usr_t" }), "ov_missing", { overrideScore: 50 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteOverride", () => {
  beforeEach(() => {
    overrideFindById.mockResolvedValue({
      id: "ov_1",
      userId: "usr_student",
      problemId: "prob_1",
      contextType: "assignment",
      contextId: "ca_hw1",
      overrideScore: 80,
      reason: "Old reason",
    });
    assessmentFindByIdWithCourseId.mockResolvedValue({
      id: "ca_hw1",
      courseId: "crs_1",
      closesAt: CLOSED_AT,
    });
    courseMembershipFindByComposite.mockResolvedValue({ role: "teacher", status: "active" });
    overrideDelete.mockResolvedValue(undefined);
    auditCreate.mockResolvedValue({});
  });

  it("writes audit with action=delete and overrideId=null", async () => {
    await deleteOverride(actor({ userId: "usr_t" }), "ov_1");

    expect(overrideDelete).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    const auditCall = auditCreate.mock.calls[0]?.[1] as {
      action: string;
      overrideId: string | null;
      oldScore: number | null;
      newScore: number | null;
      oldReason: string | null;
      newReason: string | null;
    };
    expect(auditCall.action).toBe("delete");
    expect(auditCall.overrideId).toBeNull();
    expect(auditCall.oldScore).toBe(80);
    expect(auditCall.newScore).toBeNull();
    expect(auditCall.oldReason).toBe("Old reason");
    expect(auditCall.newReason).toBeNull();
  });

  it("throws NotFoundError when the override is missing", async () => {
    overrideFindById.mockResolvedValue(null);
    await expect(
      deleteOverride(actor({ userId: "usr_t" }), "ov_missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
