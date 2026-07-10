import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  postFindById,
  postSoftDelete,
  commentFindById,
  commentSoftDelete,
  reportCreate,
  reportFindById,
  reportUpdateStatus,
  reportListByStatus,
} = vi.hoisted(() => ({
  postFindById: vi.fn(),
  postSoftDelete: vi.fn(),
  commentFindById: vi.fn(),
  commentSoftDelete: vi.fn(),
  reportCreate: vi.fn(),
  reportFindById: vi.fn(),
  reportUpdateStatus: vi.fn(),
  reportListByStatus: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  postRepo: {
    findById: postFindById,
    softDelete: postSoftDelete,
  },
  postCommentRepo: {
    findById: commentFindById,
    softDelete: commentSoftDelete,
  },
  contentReportRepo: {
    create: reportCreate,
    findById: reportFindById,
    updateStatus: reportUpdateStatus,
    listByStatus: reportListByStatus,
  },
}));

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));

vi.mock("../../../packages/application/src/notification", () => ({ createNotification }));

import { postDomain } from "@nojv/application";

const { reportContent, listContentReports, resolveContentReport } = postDomain;

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
    authorId: string;
    problemId: string;
    title: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "post_1",
    type: "editorial",
    authorId: "usr_author",
    problemId: "prob_1",
    title: "My editorial",
    deletedAt: null,
    ...overrides,
  };
}

function commentRow(
  overrides: Partial<{
    id: string;
    postId: string;
    authorId: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cmt_1",
    postId: "post_1",
    authorId: "usr_commenter",
    content: "a comment",
    deletedAt: null,
    ...overrides,
  };
}

function reportOnPost(post: ReturnType<typeof postRow> | null) {
  return { id: "rep_1", postId: post?.id ?? "post_1", commentId: null, post, comment: null };
}

function reportOnComment(
  overrides: Partial<{ authorId: string; deletedAt: Date | null }> = {},
) {
  return {
    id: "rep_1",
    postId: null,
    commentId: "cmt_1",
    post: null,
    comment: {
      id: "cmt_1",
      authorId: "usr_commenter",
      deletedAt: null,
      post: { id: "post_1", type: "editorial", title: "My editorial", problemId: "prob_1" },
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotification.mockResolvedValue(undefined);
});

describe("reportContent — post target", () => {
  it("rejects reporting your own post with ForbiddenError", async () => {
    postFindById.mockResolvedValue(postRow({ authorId: "usr_author" }));
    await expect(
      reportContent(actor("usr_author"), { postId: "post_1" }, "spam"),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing post", async () => {
    postFindById.mockResolvedValue(null);
    await expect(
      reportContent(actor("usr_reporter"), { postId: "post_1" }, "spam"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted post", async () => {
    postFindById.mockResolvedValue(postRow({ deletedAt: new Date() }));
    await expect(
      reportContent(actor("usr_reporter"), { postId: "post_1" }, "spam"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only reason", async () => {
    postFindById.mockResolvedValue(postRow());
    await expect(
      reportContent(actor("usr_reporter"), { postId: "post_1" }, "   "),
    ).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a reason longer than 1000 characters", async () => {
    postFindById.mockResolvedValue(postRow());
    await expect(
      reportContent(actor("usr_reporter"), { postId: "post_1" }, "x".repeat(1001)),
    ).rejects.toMatchObject({ name: "ValidationError", status: 400 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("creates a report on the happy path with a trimmed reason", async () => {
    postFindById.mockResolvedValue(postRow());
    reportCreate.mockResolvedValue({ id: "rep_1" });

    const result = await reportContent(
      actor("usr_reporter"),
      { postId: "post_1" },
      "  plagiarised  ",
    );

    expect(reportCreate).toHaveBeenCalledWith({
      postId: "post_1",
      reportedByUserId: "usr_reporter",
      reason: "plagiarised",
    });
    expect(result).toEqual({ id: "rep_1" });
  });

  it("maps the unique-constraint violation to ConflictError", async () => {
    postFindById.mockResolvedValue(postRow());
    const dup = Object.assign(new Error("unique"), { code: "P2002" });
    reportCreate.mockRejectedValue(dup);

    await expect(
      reportContent(actor("usr_reporter"), { postId: "post_1" }, "duplicate"),
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });
});

describe("reportContent — comment target", () => {
  it("rejects a missing comment", async () => {
    commentFindById.mockResolvedValue(null);
    await expect(
      reportContent(actor("usr_reporter"), { commentId: "cmt_1" }, "spam"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted comment", async () => {
    commentFindById.mockResolvedValue(commentRow({ deletedAt: new Date() }));
    await expect(
      reportContent(actor("usr_reporter"), { commentId: "cmt_1" }, "spam"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects reporting your own comment with ForbiddenError", async () => {
    commentFindById.mockResolvedValue(commentRow({ authorId: "usr_commenter" }));
    await expect(
      reportContent(actor("usr_commenter"), { commentId: "cmt_1" }, "spam"),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("creates a comment report on the happy path", async () => {
    commentFindById.mockResolvedValue(commentRow());
    reportCreate.mockResolvedValue({ id: "rep_1" });

    await reportContent(actor("usr_reporter"), { commentId: "cmt_1" }, "abuse");

    expect(reportCreate).toHaveBeenCalledWith({
      commentId: "cmt_1",
      reportedByUserId: "usr_reporter",
      reason: "abuse",
    });
  });

  it("maps the unique-constraint violation to ConflictError", async () => {
    commentFindById.mockResolvedValue(commentRow());
    const dup = Object.assign(new Error("unique"), { code: "P2002" });
    reportCreate.mockRejectedValue(dup);

    await expect(
      reportContent(actor("usr_reporter"), { commentId: "cmt_1" }, "duplicate"),
    ).rejects.toMatchObject({ name: "ConflictError", status: 409 });
  });
});

describe("listContentReports", () => {
  it("is admin-only", async () => {
    await expect(listContentReports(actor("usr_student", "student"))).rejects.toMatchObject({
      name: "ForbiddenError",
      status: 403,
    });
  });

  it("returns the rows for an admin", async () => {
    const rows = [{ id: "rep_1" }];
    reportListByStatus.mockResolvedValue(rows);

    await expect(listContentReports(actor("usr_admin", "admin"))).resolves.toBe(rows);
    expect(reportListByStatus).toHaveBeenCalledWith("open");
  });
});

describe("resolveContentReport", () => {
  it("is admin-only", async () => {
    await expect(
      resolveContentReport(actor("usr_student", "student"), "rep_1", "resolve"),
    ).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
  });

  it("returns NotFoundError for a missing report", async () => {
    reportFindById.mockResolvedValue(null);
    await expect(
      resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve"),
    ).rejects.toMatchObject({ name: "NotFoundError", status: 404 });
  });

  it("resolve soft-deletes the post, notifies the author, and marks the report resolved", async () => {
    reportFindById.mockResolvedValue(reportOnPost(postRow()));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
    expect(createNotification).toHaveBeenCalledWith({
      userId: "usr_author",
      type: "post_removed",
      params: { problemId: "prob_1", title: "My editorial" },
      linkUrl: "/problems/prob_1",
    });
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved", resolvedByUserId: "usr_admin" }),
    );
  });

  it("resolve soft-deletes the comment, notifies its author, and marks the report resolved", async () => {
    reportFindById.mockResolvedValue(reportOnComment());
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(commentSoftDelete).toHaveBeenCalledWith("cmt_1");
    expect(postSoftDelete).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith({
      userId: "usr_commenter",
      type: "comment_removed",
      params: { problemId: "prob_1", postTitle: "My editorial" },
      linkUrl: "/problems/prob_1",
    });
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved", resolvedByUserId: "usr_admin" }),
    );
  });

  it("resolve on an already-deleted post neither re-deletes nor re-notifies, but still closes", async () => {
    reportFindById.mockResolvedValue(reportOnPost(postRow({ deletedAt: new Date() })));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(postSoftDelete).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved", resolvedByUserId: "usr_admin" }),
    );
  });

  it("resolve on an already-deleted comment neither re-deletes nor re-notifies, but still closes", async () => {
    reportFindById.mockResolvedValue(reportOnComment({ deletedAt: new Date() }));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(commentSoftDelete).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved" }),
    );
  });

  it("still closes the report when the notification fails", async () => {
    reportFindById.mockResolvedValue(reportOnPost(postRow()));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });
    createNotification.mockRejectedValue(new Error("smtp down"));

    await expect(
      resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve"),
    ).resolves.toMatchObject({ status: "resolved" });

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
    expect(reportUpdateStatus).toHaveBeenCalled();
  });

  it("dismiss only updates the report status", async () => {
    reportFindById.mockResolvedValue(reportOnPost(postRow()));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "dismissed" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "dismiss");

    expect(postSoftDelete).not.toHaveBeenCalled();
    expect(commentSoftDelete).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "dismissed", resolvedByUserId: "usr_admin" }),
    );
  });
});
