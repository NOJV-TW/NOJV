import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted repo stubs — vi.mock is hoisted above regular imports, so these
// must be declared via vi.hoisted() for the mock factory below to see them.
const {
  contestFindById,
  assessmentFindByIdWithCourseId,
  examFindById,
  problemFindById,
  courseMembershipFindByComposite,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  problemFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
  problemRepo: { findById: problemFindById },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
}));

import { ForbiddenError, submissionDomain } from "@nojv/domain";

const { canOperateOnSubmission, assertCanOperateOnSubmission } = submissionDomain;

function actor(
  overrides: Partial<{
    userId: string;
    platformRole: "admin" | "teacher" | "student";
  }> = {},
) {
  return {
    userId: overrides.userId ?? "usr_actor",
    username: "actor",
    platformRole: overrides.platformRole ?? ("student" as const),
    displayName: "Actor",
    email: "actor@example.com",
  };
}

const baseSubmission = {
  id: "sub_1",
  userId: "usr_student",
  problemId: "prob_1",
  contestId: null as string | null,
  assessmentId: null as string | null,
  examId: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canOperateOnSubmission — admin", () => {
  it("returns true for an admin on any context (practice)", async () => {
    const result = await canOperateOnSubmission(
      actor({ platformRole: "admin" }),
      baseSubmission,
    );
    expect(result).toBe(true);
    expect(contestFindById).not.toHaveBeenCalled();
    expect(problemFindById).not.toHaveBeenCalled();
  });

  it("returns true for an admin on a contest submission", async () => {
    const result = await canOperateOnSubmission(actor({ platformRole: "admin" }), {
      ...baseSubmission,
      contestId: "ctst_1",
    });
    expect(result).toBe(true);
    expect(contestFindById).not.toHaveBeenCalled();
  });

  it("returns true for an admin on an exam submission", async () => {
    const result = await canOperateOnSubmission(actor({ platformRole: "admin" }), {
      ...baseSubmission,
      examId: "exm_1",
    });
    expect(result).toBe(true);
  });

  it("returns true for an admin on an assignment submission", async () => {
    const result = await canOperateOnSubmission(actor({ platformRole: "admin" }), {
      ...baseSubmission,
      assessmentId: "ca_1",
    });
    expect(result).toBe(true);
  });
});

describe("canOperateOnSubmission — practice context", () => {
  it("allows the problem author", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_author" }),
      baseSubmission,
    );
    expect(result).toBe(true);
  });

  it("denies a user who is not the problem author", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_stranger" }),
      baseSubmission,
    );
    expect(result).toBe(false);
  });

  it("denies when the problem row is missing", async () => {
    problemFindById.mockResolvedValue(null);
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_author" }),
      baseSubmission,
    );
    expect(result).toBe(false);
  });
});

describe("canOperateOnSubmission — assignment context", () => {
  const sub = { ...baseSubmission, assessmentId: "ca_hw1" };

  it("allows a teacher of the assignment's course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_teacher" }), sub);
    expect(result).toBe(true);
  });

  it("allows a TA of the assignment's course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_ta",
      role: "ta",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_ta" }), sub);
    expect(result).toBe(true);
  });

  it("denies a student of the course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_student" }), sub);
    expect(result).toBe(false);
  });

  it("denies a teacher with no membership in the course", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue(null);
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_unrelated", platformRole: "teacher" }),
      sub,
    );
    expect(result).toBe(false);
  });

  it("denies when the membership is removed", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "removed",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_teacher" }), sub);
    expect(result).toBe(false);
  });
});

describe("canOperateOnSubmission — exam context", () => {
  const sub = { ...baseSubmission, examId: "exm_1" };

  it("allows a teacher of the exam's course", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_teacher" }), sub);
    expect(result).toBe(true);
  });

  it("allows a TA of the exam's course", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_ta",
      role: "ta",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_ta" }), sub);
    expect(result).toBe(true);
  });

  it("denies an unrelated teacher", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue(null);
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_other_teacher", platformRole: "teacher" }),
      sub,
    );
    expect(result).toBe(false);
  });

  it("denies a student of the course", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_student",
      role: "student",
      status: "active",
    });
    const result = await canOperateOnSubmission(actor({ userId: "usr_student" }), sub);
    expect(result).toBe(false);
  });
});

describe("canOperateOnSubmission — contest context", () => {
  const sub = { ...baseSubmission, contestId: "ctst_1" };

  it("allows the contest organizer", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "usr_organizer" });
    const result = await canOperateOnSubmission(actor({ userId: "usr_organizer" }), sub);
    expect(result).toBe(true);
  });

  it("denies an unrelated teacher", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "usr_organizer" });
    const result = await canOperateOnSubmission(
      actor({ userId: "usr_other_teacher", platformRole: "teacher" }),
      sub,
    );
    expect(result).toBe(false);
  });

  it("denies when the contest row is missing", async () => {
    contestFindById.mockResolvedValue(null);
    const result = await canOperateOnSubmission(actor({ userId: "usr_organizer" }), sub);
    expect(result).toBe(false);
  });
});

describe("assertCanOperateOnSubmission", () => {
  it("resolves quietly when permitted", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    await expect(
      assertCanOperateOnSubmission(actor({ userId: "usr_author" }), baseSubmission),
    ).resolves.toBeUndefined();
  });

  it("throws ForbiddenError when denied", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    await expect(
      assertCanOperateOnSubmission(actor({ userId: "usr_stranger" }), baseSubmission),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
