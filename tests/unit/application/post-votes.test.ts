import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  postFindById,
  postExistsForUserProblem,
  voteSetVote,
  voteAggregate,
  submissionCount,
  findActiveContests,
  findActiveAssessments,
  findActiveExams,
  contestFindById,
} = vi.hoisted(() => ({
  postFindById: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  voteSetVote: vi.fn(),
  voteAggregate: vi.fn(),
  submissionCount: vi.fn(),
  findActiveContests: vi.fn(),
  findActiveAssessments: vi.fn(),
  findActiveExams: vi.fn(),
  contestFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  postRepo: {
    findById: postFindById,
    existsForUserProblem: postExistsForUserProblem,
  },
  postVoteRepo: {
    setVote: voteSetVote,
    aggregate: voteAggregate,
  },
  submissionRepo: { count: submissionCount },
  contestRepo: { findById: contestFindById },
  contestProblemRepo: { findActiveContestsForUser: findActiveContests },
  assessmentProblemRepo: { findActiveAssessmentsForUser: findActiveAssessments },
  examProblemRepo: { findActiveExamsForUser: findActiveExams },
}));

import { postDomain } from "@nojv/application";

const { castPostVote } = postDomain;

function actor(userId: string) {
  return {
    displayName: userId,
    email: `${userId}@example.test`,
    username: userId,
    platformRole: "student" as const,
    userId,
  };
}

function row(
  overrides: Partial<{
    type: "editorial" | "discussion";
    authorId: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "post_1",
    type: "editorial" as const,
    authorId: "usr_author",
    problemId: "prob_1",
    title: "Title",
    content: "body",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    author: { username: "author", name: "Author" },
    votes: [],
    ...overrides,
  };
}

beforeEach(() => {
  postFindById.mockReset();
  postExistsForUserProblem.mockReset();
  voteSetVote.mockReset();
  voteAggregate.mockReset();
  submissionCount.mockReset();
  findActiveContests.mockReset();
  findActiveAssessments.mockReset();
  findActiveExams.mockReset();
  contestFindById.mockReset();
  postExistsForUserProblem.mockResolvedValue(true);
  voteSetVote.mockResolvedValue(undefined);
  voteAggregate.mockResolvedValue({ score: 3, viewerVote: 1 });
  findActiveContests.mockResolvedValue([]);
  findActiveAssessments.mockResolvedValue([]);
  findActiveExams.mockResolvedValue([]);
});

describe("castPostVote", () => {
  it("records a viewer's vote and returns the new aggregate", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));

    const result = await castPostVote(actor("usr_viewer"), "post_1", 1);

    expect(voteSetVote).toHaveBeenCalledWith("post_1", "usr_viewer", 1);
    expect(result).toEqual({ score: 3, viewerVote: 1 });
  });

  it("forbids voting on your own post", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));

    await expect(castPostVote(actor("usr_author"), "post_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing posts", async () => {
    postFindById.mockResolvedValue(null);

    await expect(castPostVote(actor("usr_viewer"), "post_1", 1)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for soft-deleted posts", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author", deletedAt: new Date() }));

    await expect(castPostVote(actor("usr_viewer"), "post_1", 1)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("forbids voting on an editorial without AC or authored editorial", async () => {
    postFindById.mockResolvedValue(row({ type: "editorial", authorId: "usr_author" }));
    postExistsForUserProblem.mockResolvedValue(false);
    submissionCount.mockResolvedValue(0);

    await expect(castPostVote(actor("usr_viewer"), "post_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("allows voting on a discussion without AC", async () => {
    postFindById.mockResolvedValue(row({ type: "discussion", authorId: "usr_author" }));
    postExistsForUserProblem.mockResolvedValue(false);
    submissionCount.mockResolvedValue(0);

    const result = await castPostVote(actor("usr_viewer"), "post_1", 1);

    expect(voteSetVote).toHaveBeenCalledWith("post_1", "usr_viewer", 1);
    expect(result).toEqual({ score: 3, viewerVote: 1 });
    expect(submissionCount).not.toHaveBeenCalled();
  });

  it("forbids voting on a discussion while an active contest contains the problem", async () => {
    postFindById.mockResolvedValue(row({ type: "discussion", authorId: "usr_author" }));
    const endsAt = new Date(Date.now() + 60 * 60 * 1000);
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
    contestFindById.mockResolvedValue({ id: "ctx_live", endsAt });

    await expect(castPostVote(actor("usr_viewer"), "post_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("forbids voting on an editorial while an active contest contains the problem, even with AC", async () => {
    postFindById.mockResolvedValue(row({ type: "editorial", authorId: "usr_author" }));
    submissionCount.mockResolvedValue(1);
    const endsAt = new Date(Date.now() + 60 * 60 * 1000);
    findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
    contestFindById.mockResolvedValue({ id: "ctx_live", endsAt });

    await expect(castPostVote(actor("usr_viewer"), "post_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("clears a vote when value is 0", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));
    voteAggregate.mockResolvedValue({ score: 0, viewerVote: 0 });

    const result = await castPostVote(actor("usr_viewer"), "post_1", 0);

    expect(voteSetVote).toHaveBeenCalledWith("post_1", "usr_viewer", 0);
    expect(result).toEqual({ score: 0, viewerVote: 0 });
  });
});
