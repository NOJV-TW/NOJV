import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  assessmentFindByIdWithCourseId,
  examFindById,
  courseMembershipFindByComposite,
  overrideCreate,
  overrideUpdate,
  overrideDelete,
  overrideFindById,
  auditCreate,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  overrideCreate: vi.fn(),
  overrideUpdate: vi.fn(),
  overrideDelete: vi.fn(),
  overrideFindById: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
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

import { ForbiddenError, ValidationError, NotFoundError } from "@nojv/domain";
import { scoreOverrideDomain } from "@nojv/domain";

const { createOverride, updateOverride, deleteOverride, canSetScoreOverride } =
  scoreOverrideDomain;

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

describe("createOverride", () => {
  beforeEach(() => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
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

  it("denies non-staff non-admin callers", async () => {
    courseMembershipFindByComposite.mockResolvedValue({ role: "student", status: "active" });
    await expect(
      createOverride(actor({ userId: "usr_stu", platformRole: "student" }), baseInput),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(overrideCreate).not.toHaveBeenCalled();
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
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
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
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
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
