import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  postFindById,
  postSoftDelete,
  postExistsForUserProblem,
  reportCreate,
  reportFindById,
  reportUpdateStatus,
  reportListByStatus,
  submissionCount,
} = vi.hoisted(() => ({
  postFindById: vi.fn(),
  postSoftDelete: vi.fn(),
  postExistsForUserProblem: vi.fn(),
  reportCreate: vi.fn(),
  reportFindById: vi.fn(),
  reportUpdateStatus: vi.fn(),
  reportListByStatus: vi.fn(),
  submissionCount: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  postRepo: {
    findById: postFindById,
    softDelete: postSoftDelete,
    existsForUserProblem: postExistsForUserProblem,
  },
  contentReportRepo: {
    create: reportCreate,
    findById: reportFindById,
    updateStatus: reportUpdateStatus,
    listByStatus: reportListByStatus,
  },
  submissionRepo: { count: submissionCount },
}));

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));

vi.mock("../../../packages/application/src/notification", () => ({ createNotification }));

import { postDomain } from "@nojv/application";

const { reportPost, listContentReports, resolveContentReport } = postDomain;

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
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "post_1",
    type: "editorial",
    authorId: "usr_author",
    problemId: "prob_1",
    title: "My editorial",
    content: "body",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  postFindById.mockReset();
  postSoftDelete.mockReset();
  postExistsForUserProblem.mockReset();
  reportCreate.mockReset();
  reportFindById.mockReset();
  reportUpdateStatus.mockReset();
  reportListByStatus.mockReset();
  submissionCount.mockReset();
  createNotification.mockReset();
  createNotification.mockResolvedValue(undefined);
});

describe("reportPost", () => {
  it("rejects reporting your own post", async () => {
    postFindById.mockResolvedValue(postRow({ authorId: "usr_author" }));
    await expect(reportPost(actor("usr_author"), "post_1", "spam")).rejects.toMatchObject({
      name: "ValidationError",
      status: 400,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing post", async () => {
    postFindById.mockResolvedValue(null);
    await expect(reportPost(actor("usr_reporter"), "post_1", "spam")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted post", async () => {
    postFindById.mockResolvedValue(postRow({ deletedAt: new Date() }));
    await expect(reportPost(actor("usr_reporter"), "post_1", "spam")).rejects.toMatchObject({
      name: "NotFoundError",
      status: 404,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty / whitespace-only reason", async () => {
    postFindById.mockResolvedValue(postRow());
    await expect(reportPost(actor("usr_reporter"), "post_1", "   ")).rejects.toMatchObject({
      name: "ValidationError",
      status: 400,
    });
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it("creates a report on the happy path with a trimmed reason", async () => {
    postFindById.mockResolvedValue(postRow());
    reportCreate.mockResolvedValue({ id: "rep_1" });

    const result = await reportPost(actor("usr_reporter"), "post_1", "  plagiarised  ");

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
      reportPost(actor("usr_reporter"), "post_1", "duplicate"),
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

  it("resolve soft-deletes the post and marks the report resolved", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", postId: "post_1" });
    postFindById.mockResolvedValue(postRow());
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "resolved", resolvedByUserId: "usr_admin" }),
    );
  });

  it("resolve notifies the author that their post was removed", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", postId: "post_1" });
    postFindById.mockResolvedValue(postRow());
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(createNotification).toHaveBeenCalledWith({
      userId: "usr_author",
      type: "editorial_removed",
      params: { problemId: "prob_1", title: "My editorial" },
      linkUrl: "/problems/prob_1",
    });
  });

  it("resolve does not notify when the post no longer exists", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", postId: "post_1" });
    postFindById.mockResolvedValue(null);
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(postSoftDelete).toHaveBeenCalledWith("post_1");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("resolve does not notify when the post is already removed", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", postId: "post_1" });
    postFindById.mockResolvedValue(postRow({ deletedAt: new Date() }));
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "resolved" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "resolve");

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("dismiss does not soft-delete the post", async () => {
    reportFindById.mockResolvedValue({ id: "rep_1", postId: "post_1" });
    reportUpdateStatus.mockResolvedValue({ id: "rep_1", status: "dismissed" });

    await resolveContentReport(actor("usr_admin", "admin"), "rep_1", "dismiss");

    expect(postSoftDelete).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(reportUpdateStatus).toHaveBeenCalledWith(
      "rep_1",
      expect.objectContaining({ status: "dismissed", resolvedByUserId: "usr_admin" }),
    );
  });
});
