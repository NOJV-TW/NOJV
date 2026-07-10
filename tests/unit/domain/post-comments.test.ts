import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  postFindById,
  postExistsForUserProblem,
  commentListByPostId,
  commentFindById,
  commentCreate,
  commentSoftDelete,
  submissionCount,
  findActiveContests,
  findActiveAssessments,
  findActiveExams,
  contestFindById,
} = vi.hoisted(() => ({
  postFindById: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  commentListByPostId: vi.fn(),
  commentFindById: vi.fn(),
  commentCreate: vi.fn(),
  commentSoftDelete: vi.fn(),
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
  postCommentRepo: {
    listByPostId: commentListByPostId,
    findById: commentFindById,
    create: commentCreate,
    softDelete: commentSoftDelete,
  },
  submissionRepo: { count: submissionCount },
  contestRepo: { findById: contestFindById },
  contestProblemRepo: { findActiveContestsForUser: findActiveContests },
  assessmentProblemRepo: { findActiveAssessmentsForUser: findActiveAssessments },
  examProblemRepo: { findActiveExamsForUser: findActiveExams },
}));

import { postDomain } from "@nojv/application";

const { addComment, softDeleteComment, listComments } = postDomain;

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

function postRow(
  overrides: Partial<{
    id: string;
    type: "editorial" | "discussion";
    authorId: string;
    problemId: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "post_1",
    type: "discussion" as const,
    authorId: "usr_author",
    problemId: "prob_1",
    title: "title",
    content: "body",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function commentRow(
  overrides: Partial<{
    id: string;
    postId: string;
    authorId: string;
    parentId: string | null;
    content: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cmt_1",
    postId: "post_1",
    authorId: "usr_commenter",
    parentId: null,
    content: "a comment",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findActiveContests.mockResolvedValue([]);
  findActiveAssessments.mockResolvedValue([]);
  findActiveExams.mockResolvedValue([]);
  postExistsForUserProblem.mockResolvedValue(false);
  submissionCount.mockResolvedValue(0);
});

function mockActiveContest() {
  const endsAt = new Date(Date.now() + 60 * 60 * 1000);
  findActiveContests.mockResolvedValue([{ contest: { id: "ctx_live", endsAt } }]);
  contestFindById.mockResolvedValue({ id: "ctx_live", endsAt });
}

describe("addComment", () => {
  it("returns NotFoundError for a missing post", async () => {
    postFindById.mockResolvedValue(null);
    await expect(
      addComment(actor("usr_commenter"), "post_1", { content: "hi" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for a soft-deleted post", async () => {
    postFindById.mockResolvedValue(postRow({ deletedAt: new Date() }));
    await expect(
      addComment(actor("usr_commenter"), "post_1", { content: "hi" }),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("forbids commenting on an editorial without AC", async () => {
    postFindById.mockResolvedValue(postRow({ type: "editorial" }));
    await expect(
      addComment(actor("usr_stuck"), "post_1", { content: "hi" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("allows commenting on an editorial once the user has AC", async () => {
    postFindById.mockResolvedValue(postRow({ type: "editorial" }));
    submissionCount.mockResolvedValue(1);
    commentCreate.mockResolvedValue(commentRow());

    await addComment(actor("usr_solver"), "post_1", { content: "nice solution" });

    expect(commentCreate).toHaveBeenCalledWith({
      postId: "post_1",
      authorId: "usr_solver",
      parentId: null,
      content: "nice solution",
    });
  });

  it("allows commenting on a discussion without AC", async () => {
    postFindById.mockResolvedValue(postRow({ type: "discussion" }));
    commentCreate.mockResolvedValue(commentRow());

    await addComment(actor("usr_stuck"), "post_1", { content: "same question" });

    expect(commentCreate).toHaveBeenCalledWith({
      postId: "post_1",
      authorId: "usr_stuck",
      parentId: null,
      content: "same question",
    });
    expect(submissionCount).not.toHaveBeenCalled();
  });

  it("forbids commenting on a discussion while an active contest contains the problem", async () => {
    postFindById.mockResolvedValue(postRow({ type: "discussion" }));
    mockActiveContest();

    await expect(
      addComment(actor("usr_contestant"), "post_1", { content: "hint pls" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("forbids commenting on an editorial while an active contest contains the problem, even with AC", async () => {
    postFindById.mockResolvedValue(postRow({ type: "editorial" }));
    submissionCount.mockResolvedValue(1);
    mockActiveContest();

    await expect(
      addComment(actor("usr_contestant"), "post_1", { content: "spoiler" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("rejects a parentId that does not exist", async () => {
    postFindById.mockResolvedValue(postRow());
    commentFindById.mockResolvedValue(null);

    await expect(
      addComment(actor("usr_commenter"), "post_1", { content: "re", parentId: "cmt_missing" }),
    ).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("rejects a parentId that belongs to a different post", async () => {
    postFindById.mockResolvedValue(postRow());
    commentFindById.mockResolvedValue(commentRow({ postId: "post_other" }));

    await expect(
      addComment(actor("usr_commenter"), "post_1", { content: "re", parentId: "cmt_1" }),
    ).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("rejects replying to a reply (no third nesting level)", async () => {
    postFindById.mockResolvedValue(postRow());
    commentFindById.mockResolvedValue(commentRow({ id: "cmt_reply", parentId: "cmt_root" }));

    await expect(
      addComment(actor("usr_commenter"), "post_1", { content: "re", parentId: "cmt_reply" }),
    ).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(commentCreate).not.toHaveBeenCalled();
  });

  it("allows replying to a soft-deleted parent comment", async () => {
    postFindById.mockResolvedValue(postRow());
    commentFindById.mockResolvedValue(commentRow({ deletedAt: new Date() }));
    commentCreate.mockResolvedValue(commentRow({ id: "cmt_2", parentId: "cmt_1" }));

    await addComment(actor("usr_commenter"), "post_1", { content: "re", parentId: "cmt_1" });

    expect(commentCreate).toHaveBeenCalledWith({
      postId: "post_1",
      authorId: "usr_commenter",
      parentId: "cmt_1",
      content: "re",
    });
  });
});

describe("softDeleteComment", () => {
  it("allows the author to delete their own comment", async () => {
    commentFindById.mockResolvedValue(commentRow({ authorId: "usr_commenter" }));
    commentSoftDelete.mockResolvedValue(commentRow({ deletedAt: new Date() }));

    await softDeleteComment(actor("usr_commenter"), "cmt_1");

    expect(commentSoftDelete).toHaveBeenCalledWith("cmt_1");
  });

  it("allows an admin to delete another user's comment", async () => {
    commentFindById.mockResolvedValue(commentRow({ authorId: "usr_someone_else" }));
    commentSoftDelete.mockResolvedValue(commentRow({ deletedAt: new Date() }));

    await softDeleteComment(actor("usr_admin", "admin"), "cmt_1");

    expect(commentSoftDelete).toHaveBeenCalledWith("cmt_1");
  });

  it("forbids non-author non-admin users", async () => {
    commentFindById.mockResolvedValue(commentRow({ authorId: "usr_commenter" }));

    await expect(softDeleteComment(actor("usr_intruder"), "cmt_1")).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
    expect(commentSoftDelete).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for a missing comment", async () => {
    commentFindById.mockResolvedValue(null);

    await expect(softDeleteComment(actor("usr_commenter"), "cmt_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(commentSoftDelete).not.toHaveBeenCalled();
  });

  it("returns NotFoundError for an already-deleted comment", async () => {
    commentFindById.mockResolvedValue(commentRow({ deletedAt: new Date() }));

    await expect(softDeleteComment(actor("usr_commenter"), "cmt_1")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(commentSoftDelete).not.toHaveBeenCalled();
  });
});

describe("listComments", () => {
  it("returns live comments with their content and deleted: false", async () => {
    const author = { username: "alice", name: "Alice" };
    commentListByPostId.mockResolvedValue(
      [commentRow({ content: "visible" })].map((r) => ({
        ...r,
        author,
      })),
    );

    const result = await listComments("post_1");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ content: "visible", deleted: false, author });
  });

  it("blanks the content of deleted comments but keeps the author", async () => {
    const author = { username: "bob", name: "Bob" };
    commentListByPostId.mockResolvedValue([
      { ...commentRow({ id: "cmt_live", content: "still here" }), author },
      {
        ...commentRow({ id: "cmt_gone", content: "secret", deletedAt: new Date() }),
        author,
      },
    ]);

    const result = await listComments("post_1");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "cmt_live", content: "still here", deleted: false });
    expect(result[1]).toMatchObject({ id: "cmt_gone", content: "", deleted: true, author });
    expect(JSON.stringify(result[1])).not.toContain("secret");
  });
});
