import { beforeEach, expect, it, vi } from "vitest";

const { activeAssignments, assignmentInfo, acceptedCount } = vi.hoisted(() => ({
  activeAssignments: vi.fn(),
  assignmentInfo: vi.fn(),
  acceptedCount: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  problemRepo: { findById: async () => ({ id: "problem" }) },
  postRepo: { existsForUserProblem: async () => false },
  submissionRepo: { count: acceptedCount },
  contestProblemRepo: { findActiveContestsForUser: async () => [] },
  assessmentProblemRepo: { findActiveAssessmentsForUser: activeAssignments },
  examProblemRepo: { findActiveExamsForUser: async () => [] },
  assessmentRepo: { findInfoById: assignmentInfo },
}));
vi.mock("$lib/server/auth", async () => {
  const { ForbiddenError, NotFoundError } =
    await import("../../../packages/application/src/shared/errors");
  return { ForbiddenError, NotFoundError };
});

import { postDomain } from "@nojv/application";
import { requireProblemPostAccess } from "../../../apps/web/src/lib/server/post-access";

beforeEach(() => {
  vi.resetAllMocks();
  acceptedCount.mockResolvedValue(1);
  const closesAt = new Date(Date.now() + 60_000);
  activeAssignments.mockResolvedValue([{ assessment: { id: "assignment", closesAt } }]);
  assignmentInfo.mockResolvedValue({ closesAt });
});

it.each(["read", "write"])(
  "explains the live activity gate to an accepted solver on %s",
  async (operation) => {
    const result =
      operation === "read"
        ? requireProblemPostAccess("student", "problem", "editorial", false)
        : postDomain.assertCanInteractWithPosts(
            "student",
            "problem",
            "editorial",
            "Solve this problem first to post an editorial.",
          );
    await expect(result).rejects.toMatchObject({
      status: 403,
      message: "Posts are unavailable until the active contest, assignment, or exam ends.",
    });
  },
);

it("retains the solve-first error when no activity is active and the student has no AC", async () => {
  activeAssignments.mockResolvedValue([]);
  acceptedCount.mockResolvedValue(0);
  await expect(
    requireProblemPostAccess("student", "problem", "editorial", false),
  ).rejects.toMatchObject({
    status: 403,
    message: "Solve this problem first to view editorials.",
  });
});
