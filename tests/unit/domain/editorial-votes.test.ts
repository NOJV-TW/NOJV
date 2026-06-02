import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  editorialFindById,
  editorialExistsForUserProblem,
  voteSetVote,
  voteAggregate,
  submissionCount,
} = vi.hoisted(() => ({
  editorialFindById: vi.fn(),
  editorialExistsForUserProblem: vi.fn(),
  voteSetVote: vi.fn(),
  voteAggregate: vi.fn(),
  submissionCount: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  editorialRepo: {
    findById: editorialFindById,
    existsForUserProblem: editorialExistsForUserProblem,
  },
  editorialVoteRepo: {
    setVote: voteSetVote,
    aggregate: voteAggregate,
  },
  submissionRepo: { count: submissionCount },
  contestProblemRepo: { findActiveContestsForUser: vi.fn().mockResolvedValue([]) },
  assessmentProblemRepo: { findActiveAssessmentsForUser: vi.fn().mockResolvedValue([]) },
  examProblemRepo: { findActiveExamsForUser: vi.fn().mockResolvedValue([]) },
}));

import { editorialDomain } from "@nojv/domain";

const { castEditorialVote } = editorialDomain;

function actor(userId: string) {
  return {
    displayName: userId,
    email: `${userId}@example.test`,
    username: userId,
    platformRole: "student" as const,
    userId,
  };
}

function row(overrides: Partial<{ userId: string; deletedAt: Date | null }> = {}) {
  return {
    id: "ed_1",
    userId: "usr_author",
    problemId: "prob_1",
    title: "Title",
    content: "body",
    language: "cpp",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    user: { username: "author", name: "Author" },
    ...overrides,
  };
}

beforeEach(() => {
  editorialFindById.mockReset();
  editorialExistsForUserProblem.mockReset();
  voteSetVote.mockReset();
  voteAggregate.mockReset();
  submissionCount.mockReset();
  editorialExistsForUserProblem.mockResolvedValue(true);
  voteSetVote.mockResolvedValue(undefined);
  voteAggregate.mockResolvedValue({ score: 3, viewerVote: 1 });
});

describe("castEditorialVote", () => {
  it("records a viewer's vote and returns the new aggregate", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));

    const result = await castEditorialVote(actor("usr_viewer"), "ed_1", 1);

    expect(voteSetVote).toHaveBeenCalledWith("ed_1", "usr_viewer", 1);
    expect(result).toEqual({ score: 3, viewerVote: 1 });
  });

  it("forbids voting on your own editorial", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));

    await expect(castEditorialVote(actor("usr_author"), "ed_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing editorials", async () => {
    editorialFindById.mockResolvedValue(null);

    await expect(castEditorialVote(actor("usr_viewer"), "ed_1", 1)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for soft-deleted editorials", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author", deletedAt: new Date() }));

    await expect(castEditorialVote(actor("usr_viewer"), "ed_1", 1)).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("forbids voters who cannot view editorials for the problem", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    editorialExistsForUserProblem.mockResolvedValue(false);
    submissionCount.mockResolvedValue(0);

    await expect(castEditorialVote(actor("usr_viewer"), "ed_1", 1)).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(voteSetVote).not.toHaveBeenCalled();
  });

  it("clears a vote when value is 0", async () => {
    editorialFindById.mockResolvedValue(row({ userId: "usr_author" }));
    voteAggregate.mockResolvedValue({ score: 0, viewerVote: 0 });

    const result = await castEditorialVote(actor("usr_viewer"), "ed_1", 0);

    expect(voteSetVote).toHaveBeenCalledWith("ed_1", "usr_viewer", 0);
    expect(result).toEqual({ score: 0, viewerVote: 0 });
  });
});
