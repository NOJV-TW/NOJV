import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submissionCount,
  postExistsForUserProblem,
  postListByProblemIdPaged,
  postCountByProblemId,
  postFindById,
} = vi.hoisted(() => ({
  submissionCount: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  postListByProblemIdPaged: vi.fn(),
  postCountByProblemId: vi.fn(),
  postFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  submissionRepo: { count: submissionCount },
  postRepo: {
    existsForUserProblem: postExistsForUserProblem,
    listByProblemIdPaged: postListByProblemIdPaged,
    countByProblemId: postCountByProblemId,
    findById: postFindById,
  },
}));

import { postDomain } from "@nojv/application";

const { hasUserAcProblem, canViewPosts, listPostsPage, getPostById } = postDomain;

beforeEach(() => {
  submissionCount.mockReset();
  postExistsForUserProblem.mockReset();
  postListByProblemIdPaged.mockReset();
  postCountByProblemId.mockReset();
  postFindById.mockReset();
});

describe("hasUserAcProblem", () => {
  it("returns true when the user has ≥1 accepted non-sample submission", async () => {
    submissionCount.mockResolvedValue(3);
    await expect(hasUserAcProblem("usr_1", "prob_1")).resolves.toBe(true);
  });

  it("returns false when the user has zero accepted non-sample submissions", async () => {
    submissionCount.mockResolvedValue(0);
    await expect(hasUserAcProblem("usr_1", "prob_1")).resolves.toBe(false);
  });

  it("filters on status='accepted' and sampleOnly=false", async () => {
    submissionCount.mockResolvedValue(1);
    await hasUserAcProblem("usr_1", "prob_1");
    expect(submissionCount).toHaveBeenCalledWith({
      userId: "usr_1",
      problemId: "prob_1",
      status: "accepted",
      sampleOnly: false,
    });
  });
});

describe("canViewPosts — editorial type", () => {
  it("allows a user with an accepted submission", async () => {
    submissionCount.mockResolvedValue(1);
    postExistsForUserProblem.mockResolvedValue(false);
    await expect(canViewPosts("usr_1", "prob_1", "editorial")).resolves.toBe(true);
  });

  it("allows an editorial author without AC", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(true);
    await expect(canViewPosts("usr_1", "prob_1", "editorial")).resolves.toBe(true);
  });

  it("denies a user with neither AC nor an authored editorial", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(false);
    await expect(canViewPosts("usr_1", "prob_1", "editorial")).resolves.toBe(false);
  });
});

describe("canViewPosts — discussion type", () => {
  it("allows any user when the gate is open, without checking AC or authorship", async () => {
    await expect(canViewPosts("usr_1", "prob_1", "discussion")).resolves.toBe(true);
    expect(submissionCount).not.toHaveBeenCalled();
    expect(postExistsForUserProblem).not.toHaveBeenCalled();
  });

  it("allows a non-AC user with an explicit practice context", async () => {
    await expect(
      canViewPosts("usr_1", "prob_1", "discussion", { kind: "practice" }),
    ).resolves.toBe(true);
  });
});

function pagedRow(
  overrides: Partial<{
    id: string;
    votes: { userId: string; value: number }[];
    _count: { comments: number };
  }> = {},
) {
  return {
    id: "post_1",
    type: "discussion",
    authorId: "usr_author",
    problemId: "prob_1",
    title: "Title",
    content: "body",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    author: { username: "author", name: "Author" },
    votes: [],
    _count: { comments: 0 },
    ...overrides,
  };
}

describe("listPostsPage", () => {
  it("passes type through to the repository and returns paging metadata", async () => {
    postListByProblemIdPaged.mockResolvedValue([]);
    postCountByProblemId.mockResolvedValue(0);

    const result = await listPostsPage({
      problemId: "prob_1",
      type: "discussion",
      viewerId: "usr_viewer",
      page: 2,
      pageSize: 10,
    });

    expect(postListByProblemIdPaged).toHaveBeenCalledWith("prob_1", "discussion", 10, 10);
    expect(postCountByProblemId).toHaveBeenCalledWith("prob_1", "discussion");
    expect(result).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
  });

  it("clamps page and pageSize to sane bounds", async () => {
    postListByProblemIdPaged.mockResolvedValue([]);
    postCountByProblemId.mockResolvedValue(0);

    const result = await listPostsPage({
      problemId: "prob_1",
      type: "editorial",
      viewerId: "usr_viewer",
      page: 0,
      pageSize: 1000,
    });

    expect(postListByProblemIdPaged).toHaveBeenCalledWith("prob_1", "editorial", 0, 100);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it("maps votes to voteScore/viewerVote and comment counts to commentCount", async () => {
    postListByProblemIdPaged.mockResolvedValue([
      pagedRow({
        id: "post_1",
        votes: [
          { userId: "usr_viewer", value: 1 },
          { userId: "usr_other", value: 1 },
          { userId: "usr_third", value: -1 },
        ],
        _count: { comments: 4 },
      }),
      pagedRow({ id: "post_2" }),
    ]);
    postCountByProblemId.mockResolvedValue(2);

    const { items } = await listPostsPage({
      problemId: "prob_1",
      type: "discussion",
      viewerId: "usr_viewer",
      page: 1,
      pageSize: 20,
    });

    expect(items[0]).toMatchObject({
      id: "post_1",
      voteScore: 1,
      viewerVote: 1,
      commentCount: 4,
    });
    expect(items[0]).not.toHaveProperty("votes");
    expect(items[0]).not.toHaveProperty("_count");
    expect(items[1]).toMatchObject({
      id: "post_2",
      voteScore: 0,
      viewerVote: 0,
      commentCount: 0,
    });
  });
});

describe("getPostById", () => {
  function detailRow(
    overrides: Partial<{
      deletedAt: Date | null;
      votes: { userId: string; value: number }[];
    }> = {},
  ) {
    return {
      id: "post_1",
      type: "editorial",
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

  it("returns the row with vote aggregates when present and not soft-deleted", async () => {
    postFindById.mockResolvedValue(
      detailRow({
        votes: [
          { userId: "usr_viewer", value: -1 },
          { userId: "usr_other", value: 1 },
        ],
      }),
    );

    const result = await getPostById("post_1", "usr_viewer");

    expect(result).toMatchObject({ id: "post_1", voteScore: 0, viewerVote: -1 });
    expect(result).not.toHaveProperty("votes");
  });

  it("returns null for missing rows", async () => {
    postFindById.mockResolvedValue(null);
    await expect(getPostById("post_1", "usr_viewer")).resolves.toBeNull();
  });

  it("returns null for soft-deleted rows", async () => {
    postFindById.mockResolvedValue(detailRow({ deletedAt: new Date() }));
    await expect(getPostById("post_1", "usr_viewer")).resolves.toBeNull();
  });
});
