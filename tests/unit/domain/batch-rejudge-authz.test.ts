import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  contestFindById,
  assessmentFindByIdWithCourseId,
  examFindById,
  problemFindById,
  courseMembershipFindByComposite,
  submissionAnyWithContextForProblem,
} = vi.hoisted(() => ({
  contestFindById: vi.fn(),
  assessmentFindByIdWithCourseId: vi.fn(),
  examFindById: vi.fn(),
  problemFindById: vi.fn(),
  courseMembershipFindByComposite: vi.fn(),
  submissionAnyWithContextForProblem: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  contestRepo: { findById: contestFindById },
  assessmentRepo: { findByIdWithCourseId: assessmentFindByIdWithCourseId },
  examRepo: { findById: examFindById },
  problemRepo: { findById: problemFindById },
  courseMembershipRepo: { findByComposite: courseMembershipFindByComposite },
  submissionRepo: { anyWithContextForProblem: submissionAnyWithContextForProblem },
}));

import { ForbiddenError, submissionDomain } from "@nojv/domain";

const { assertBatchRejudgeAccess } = submissionDomain;

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

const baseBatch = {
  mode: "batch" as const,
  problemId: "prob_1",
  triggeredByUserId: "usr_actor",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertBatchRejudgeAccess — admin bypass", () => {
  it("resolves quietly for admin regardless of scope", async () => {
    await expect(
      assertBatchRejudgeAccess(actor({ platformRole: "admin" }), baseBatch),
    ).resolves.toBeUndefined();
    expect(contestFindById).not.toHaveBeenCalled();
    expect(problemFindById).not.toHaveBeenCalled();
  });
});

describe("assertBatchRejudgeAccess — contest-scoped", () => {
  it("allows the contest organizer", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "usr_organizer" });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_organizer" }), {
        ...baseBatch,
        contestId: "ctst_1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-organizer", async () => {
    contestFindById.mockResolvedValue({ id: "ctst_1", createdByUserId: "usr_organizer" });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_stranger" }), {
        ...baseBatch,
        contestId: "ctst_1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects when contest is missing", async () => {
    contestFindById.mockResolvedValue(null);
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_organizer" }), {
        ...baseBatch,
        contestId: "ctst_1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assertBatchRejudgeAccess — assessment-scoped", () => {
  it("allows a course teacher", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_teacher" }), {
        ...baseBatch,
        assessmentId: "ca_hw1",
      }),
    ).resolves.toBeUndefined();
  });

  it("allows a course TA", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_ta",
      role: "ta",
      status: "active",
    });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_ta" }), {
        ...baseBatch,
        assessmentId: "ca_hw1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-staff user", async () => {
    assessmentFindByIdWithCourseId.mockResolvedValue({ id: "ca_hw1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue(null);
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_stranger" }), {
        ...baseBatch,
        assessmentId: "ca_hw1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assertBatchRejudgeAccess — exam-scoped", () => {
  it("allows a course teacher", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue({
      courseId: "crs_1",
      userId: "usr_teacher",
      role: "teacher",
      status: "active",
    });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_teacher" }), {
        ...baseBatch,
        examId: "exm_1",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-staff user", async () => {
    examFindById.mockResolvedValue({ id: "exm_1", courseId: "crs_1" });
    courseMembershipFindByComposite.mockResolvedValue(null);
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_stranger" }), {
        ...baseBatch,
        examId: "exm_1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("assertBatchRejudgeAccess — unscoped (bare problemId)", () => {
  it("allows the problem author when no non-practice submissions exist", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    submissionAnyWithContextForProblem.mockResolvedValue(false);
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_author" }), baseBatch),
    ).resolves.toBeUndefined();
  });

  it("rejects the problem author when non-practice submissions exist", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    submissionAnyWithContextForProblem.mockResolvedValue(true);
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_author" }), baseBatch),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a non-author", async () => {
    problemFindById.mockResolvedValue({ id: "prob_1", authorId: "usr_author" });
    await expect(
      assertBatchRejudgeAccess(actor({ userId: "usr_stranger" }), baseBatch),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Short-circuits before checking non-practice submissions.
    expect(submissionAnyWithContextForProblem).not.toHaveBeenCalled();
  });
});
