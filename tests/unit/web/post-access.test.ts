import { beforeEach, expect, it, vi } from "vitest";

const { activeAssignments, assignmentInfo, acceptedCount, problemFind, postFind } = vi.hoisted(
  () => ({
    activeAssignments: vi.fn(),
    assignmentInfo: vi.fn(),
    acceptedCount: vi.fn(),
    problemFind: vi.fn(),
    postFind: vi.fn(),
  }),
);

vi.mock("@nojv/db", () => ({
  problemRepo: { findById: problemFind },
  postRepo: { existsForUserProblem: async () => false, findById: postFind },
  courseProblemRepo: { hasStaffAccess: async () => false },
  submissionRepo: { count: acceptedCount },
  contestProblemRepo: {
    findActiveContestsForUser: async () => [],
    hasEndedContestForUser: async () => false,
  },
  assessmentProblemRepo: {
    findActiveAssessmentsForUser: activeAssignments,
    hasEndedAssessmentForUser: async () => false,
  },
  examProblemRepo: {
    findActiveExamsForUser: async () => [],
    hasEndedExamForUser: async () => false,
  },
  assessmentRepo: { findInfoById: assignmentInfo },
}));

import { postDomain } from "@nojv/application";
import {
  requireProblemPostAccess,
  requireViewablePost,
} from "../../../apps/web/src/lib/server/post-access";

const actor = {
  userId: "student",
  username: "student",
  platformRole: "student" as const,
  displayName: "Student",
  email: "student@example.test",
  emailVerified: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  problemFind.mockResolvedValue({ id: "problem", authorId: "owner", visibility: "public" });
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
        ? requireProblemPostAccess(actor, "problem", "editorial")
        : postDomain.assertCanInteractWithPosts(
            actor,
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
  await expect(requireProblemPostAccess(actor, "problem", "editorial")).rejects.toMatchObject({
    status: 403,
    message: "Solve this problem first to view editorials.",
  });
});

it.each(["discussion", "editorial"] as const)(
  "hides private-problem %s reads from an unrelated accepted solver",
  async (type) => {
    activeAssignments.mockResolvedValue([]);
    problemFind.mockResolvedValue({ id: "problem", authorId: "owner", visibility: "private" });
    postFind.mockResolvedValue({
      id: "post",
      problemId: "problem",
      type,
      deletedAt: null,
      votes: [],
      content: "private",
    });
    await expect(requireProblemPostAccess(actor, "problem", type)).rejects.toMatchObject({
      status: 404,
    });
    await expect(requireViewablePost("post", actor)).rejects.toMatchObject({ status: 404 });
  },
);

it("retains moderation access only for the trusted effective admin actor", async () => {
  problemFind.mockResolvedValue({ id: "problem", authorId: "owner", visibility: "private" });
  await expect(requireProblemPostAccess(actor, "problem", "discussion")).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    requireProblemPostAccess({ ...actor, platformRole: "admin" }, "problem", "editorial"),
  ).resolves.toMatchObject({ id: "problem" });
});
