import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  postFindById,
  postCreate,
  postUpdate,
  postSoftDelete,
  postExistsForUserProblem,
  submissionCount,
  findActiveContests,
  findActiveAssessments,
  findActiveExams,
  contestFindById,
} = vi.hoisted(() => ({
  postFindById: vi.fn(),
  postCreate: vi.fn(),
  postUpdate: vi.fn(),
  postSoftDelete: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  submissionCount: vi.fn(),
  findActiveContests: vi.fn(),
  findActiveAssessments: vi.fn(),
  findActiveExams: vi.fn(),
  contestFindById: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  postRepo: {
    findById: postFindById,
    create: postCreate,
    update: postUpdate,
    softDelete: postSoftDelete,
    existsForUserProblem: postExistsForUserProblem,
  },
  submissionRepo: { count: submissionCount },
  contestRepo: { findById: contestFindById },
  contestProblemRepo: { findActiveContestsForUser: findActiveContests },
  assessmentProblemRepo: { findActiveAssessmentsForUser: findActiveAssessments },
  examProblemRepo: { findActiveExamsForUser: findActiveExams },
}));

import { postDomain } from "@nojv/application";

const { createPost, updatePost, softDeletePost } = postDomain;

interface FakeActor {
  displayName: string;
  email: string;
  username: string;
  platformRole: "admin" | "teacher" | "student";
  userId: string;
}

function actor(userId: string, platformRole: FakeActor["platformRole"] = "student"): FakeActor {
  return {
    displayName: userId,
    email: `${userId}@example.test`,
    username: userId,
    platformRole,
    userId,
  };
}

function row(
  overrides: Partial<{
    id: string;
    type: "editorial" | "discussion";
    authorId: string;
    problemId: string;
    title: string;
    content: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "post_1",
    type: "editorial" as const,
    authorId: "usr_author",
    problemId: "prob_1",
    title: "old title",
    content: "old body",
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
  postCreate.mockReset();
  postUpdate.mockReset();
  postSoftDelete.mockReset();
  postExistsForUserProblem.mockReset();
  submissionCount.mockReset();
  findActiveContests.mockReset();
  findActiveAssessments.mockReset();
  findActiveExams.mockReset();
  contestFindById.mockReset();
  findActiveContests.mockResolvedValue([]);
  findActiveAssessments.mockResolvedValue([]);
  findActiveExams.mockResolvedValue([]);
  postExistsForUserProblem.mockResolvedValue(false);
});

function mockActiveContest() {
  const endsAt = new Date(Date.now() + 60 * 60 * 1000);
  findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
  contestFindById.mockResolvedValue({ id: "ctx_live", endsAt });
}

describe("createPost", () => {
  it("creates an editorial for a user with AC", async () => {
    submissionCount.mockResolvedValue(1);
    const created = row({ type: "editorial" });
    postCreate.mockResolvedValue(created);

    const result = await createPost(actor("usr_solver"), {
      type: "editorial",
      problemId: "prob_1",
      title: "My solution",
      content: "explanation",
    });

    expect(postCreate).toHaveBeenCalledWith({
      type: "editorial",
      authorId: "usr_solver",
      problemId: "prob_1",
      title: "My solution",
      content: "explanation",
    });
    expect(result).toBe(created);
  });

  it("forbids an editorial from a non-AC non-author user", async () => {
    submissionCount.mockResolvedValue(0);
    postExistsForUserProblem.mockResolvedValue(false);

    await expect(
      createPost(actor("usr_stuck"), {
        type: "editorial",
        problemId: "prob_1",
        title: "Title",
        content: "body",
      }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("creates a discussion without requiring AC", async () => {
    const created = row({ type: "discussion" });
    postCreate.mockResolvedValue(created);

    const result = await createPost(actor("usr_stuck"), {
      type: "discussion",
      problemId: "prob_1",
      title: "How to approach this?",
      content: "I am stuck on subtask 2",
    });

    expect(postCreate).toHaveBeenCalledWith({
      type: "discussion",
      authorId: "usr_stuck",
      problemId: "prob_1",
      title: "How to approach this?",
      content: "I am stuck on subtask 2",
    });
    expect(result).toBe(created);
    expect(submissionCount).not.toHaveBeenCalled();
  });

  it("forbids a discussion while an active contest contains the problem", async () => {
    mockActiveContest();

    await expect(
      createPost(actor("usr_contestant"), {
        type: "discussion",
        problemId: "prob_1",
        title: "hint pls",
        content: "how to solve this contest problem",
      }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(postCreate).not.toHaveBeenCalled();
  });

  it("forbids an editorial while an active contest contains the problem, even with AC", async () => {
    submissionCount.mockResolvedValue(1);
    mockActiveContest();

    await expect(
      createPost(actor("usr_contestant"), {
        type: "editorial",
        problemId: "prob_1",
        title: "Solution",
        content: "spoiler",
      }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(postCreate).not.toHaveBeenCalled();
  });
});

describe("updatePost", () => {
  it("allows the author to edit their own post", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));
    postUpdate.mockResolvedValue(row({ content: "new body" }));

    const result = await updatePost(actor("usr_author"), "post_1", { content: "new body" });

    expect(postUpdate).toHaveBeenCalledWith("post_1", { content: "new body" });
    expect(result).toMatchObject({ content: "new body" });
  });

  it("allows an admin to edit another user's post", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_someone_else" }));
    postUpdate.mockResolvedValue(row({ content: "moderated" }));

    await updatePost(actor("usr_admin", "admin"), "post_1", { content: "moderated" });

    expect(postUpdate).toHaveBeenCalledWith("post_1", { content: "moderated" });
  });

  it("forbids non-author non-admin users", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));
    await expect(
      updatePost(actor("usr_intruder"), "post_1", { content: "vandalism vandalism" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing posts", async () => {
    postFindById.mockResolvedValue(null);
    await expect(
      updatePost(actor("usr_author"), "post_1", { content: "new body" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for soft-deleted posts (hides existence)", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author", deletedAt: new Date() }));
    await expect(
      updatePost(actor("usr_author"), "post_1", { content: "new body" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(postUpdate).not.toHaveBeenCalled();
  });

  it("skips the write when nothing actually changed", async () => {
    const existing = row({ authorId: "usr_author", title: "same title", content: "same body" });
    postFindById.mockResolvedValue(existing);

    const result = await updatePost(actor("usr_author"), "post_1", {
      title: "same title",
      content: "same body",
    });

    expect(postUpdate).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it("only forwards fields that actually changed", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author", title: "old title" }));
    postUpdate.mockResolvedValue(row());

    await updatePost(actor("usr_author"), "post_1", {
      title: "new title",
      content: "old body",
    });

    expect(postUpdate).toHaveBeenCalledWith("post_1", { title: "new title" });
  });
});

describe("softDeletePost", () => {
  it("allows the author to delete their own post", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));
    postSoftDelete.mockResolvedValue(row({ deletedAt: new Date() }));

    await softDeletePost(actor("usr_author"), "post_1");

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
  });

  it("allows an admin to delete another user's post", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_someone_else" }));
    postSoftDelete.mockResolvedValue(row({ deletedAt: new Date() }));

    await softDeletePost(actor("usr_admin", "admin"), "post_1");

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
  });

  it("forbids non-author non-admin users", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author" }));
    await expect(softDeletePost(actor("usr_intruder"), "post_1")).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(postSoftDelete).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for missing posts", async () => {
    postFindById.mockResolvedValue(null);
    await expect(softDeletePost(actor("usr_author"), "post_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(postSoftDelete).not.toHaveBeenCalled();
  });

  it("treats double-delete as 404 (idempotent NotFoundError on the second call)", async () => {
    postFindById.mockResolvedValue(row({ authorId: "usr_author", deletedAt: new Date() }));
    await expect(softDeletePost(actor("usr_author"), "post_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(postSoftDelete).not.toHaveBeenCalled();
  });
});
