import { describe, expect, it } from "vitest";

import { notificationRepo } from "@nojv/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  postDomain,
} from "@nojv/application";

import { createTestProblem, createTestUser, testPrisma } from "../../fixtures/factories";

const { reportContent, listContentReports, resolveContentReport } = postDomain;

interface ActorOverrides {
  platformRole?: "student" | "teacher" | "admin";
}

async function buildActor(overrides: ActorOverrides = {}) {
  const user = await createTestUser({ platformRole: overrides.platformRole ?? "student" });
  return {
    userId: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    email: user.email,
    platformRole: user.platformRole as "student" | "teacher" | "admin",
  };
}

async function createPostRow(
  authorId: string,
  problemId: string,
  type: "editorial" | "discussion" = "discussion",
) {
  return testPrisma.problemPost.create({
    data: {
      type,
      authorId,
      problemId,
      title: "A test post",
      content: "A sufficiently long post body for the test.",
    },
  });
}

async function createCommentRow(postId: string, authorId: string) {
  return testPrisma.postComment.create({
    data: { postId, authorId, content: "A comment worth reporting." },
  });
}

describe("postDomain.reportContent — integration", () => {
  it("creates a report row with a trimmed reason on the happy path", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);

    const report = await reportContent(reporter, { postId: post.id }, "  spam content  ");

    const persisted = await testPrisma.contentReport.findUnique({ where: { id: report.id } });
    expect(persisted).not.toBeNull();
    expect(persisted!.reason).toBe("spam content");
    expect(persisted!.status).toBe("open");
    expect(persisted!.postId).toBe(post.id);
    expect(persisted!.reportedByUserId).toBe(reporter.userId);
  });

  it("rejects a second report from the same user via the unique constraint", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);

    await reportContent(reporter, { postId: post.id }, "first");
    await expect(reportContent(reporter, { postId: post.id }, "second")).rejects.toBeInstanceOf(
      ConflictError,
    );

    const all = await testPrisma.contentReport.findMany({ where: { postId: post.id } });
    expect(all).toHaveLength(1);
  });

  it("rejects reporting your own post with ForbiddenError", async () => {
    const author = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);

    await expect(reportContent(author, { postId: post.id }, "self")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects an editorial report from a reporter who has not solved the problem", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id, "editorial");

    await expect(reportContent(reporter, { postId: post.id }, "spam")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects an empty reason with ValidationError", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);

    await expect(reportContent(reporter, { postId: post.id }, "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a report against a soft-deleted post", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    await testPrisma.problemPost.update({
      where: { id: post.id },
      data: { deletedAt: new Date() },
    });

    await expect(reportContent(reporter, { postId: post.id }, "late")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("creates a report against a comment", async () => {
    const author = await buildActor();
    const commenter = await buildActor();
    const reporter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const comment = await createCommentRow(post.id, commenter.userId);

    const report = await reportContent(reporter, { commentId: comment.id }, "abusive");

    const persisted = await testPrisma.contentReport.findUnique({ where: { id: report.id } });
    expect(persisted!.commentId).toBe(comment.id);
    expect(persisted!.postId).toBeNull();
    expect(persisted!.reason).toBe("abusive");
  });

  it("rejects reporting your own comment with ForbiddenError", async () => {
    const author = await buildActor();
    const commenter = await buildActor();
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const comment = await createCommentRow(post.id, commenter.userId);

    await expect(
      reportContent(commenter, { commentId: comment.id }, "self"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("postDomain.listContentReports — integration", () => {
  it("returns open reports for an admin", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const report = await reportContent(reporter, { postId: post.id }, "needs review");

    const rows = await listContentReports(admin, "open");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(report.id);
  });

  it("throws ForbiddenError for a non-admin", async () => {
    const teacher = await buildActor({ platformRole: "teacher" });
    await expect(listContentReports(teacher, "open")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("postDomain.resolveContentReport — integration", () => {
  it("resolve soft-deletes the post, notifies the author, and marks the report resolved", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const report = await reportContent(reporter, { postId: post.id }, "plagiarised");

    await resolveContentReport(admin, report.id, "resolve");

    const persistedPost = await testPrisma.problemPost.findUnique({ where: { id: post.id } });
    expect(persistedPost!.deletedAt).not.toBeNull();

    const persistedReport = await testPrisma.contentReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("resolved");
    expect(persistedReport!.resolvedByUserId).toBe(admin.userId);
    expect(persistedReport!.resolvedAt).not.toBeNull();

    const notifications = await notificationRepo.listRecent(author.userId, 10);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("post_removed");
    expect(notifications[0]!.linkUrl).toBe(`/problems/${problem.id}`);
    expect(notifications[0]!.params).toMatchObject({
      problemId: problem.id,
      title: post.title,
    });
  });

  it("resolve soft-deletes a reported comment and notifies its author", async () => {
    const author = await buildActor();
    const commenter = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const comment = await createCommentRow(post.id, commenter.userId);
    const report = await reportContent(reporter, { commentId: comment.id }, "abusive");

    await resolveContentReport(admin, report.id, "resolve");

    const persistedComment = await testPrisma.postComment.findUnique({
      where: { id: comment.id },
    });
    expect(persistedComment!.deletedAt).not.toBeNull();

    const persistedPost = await testPrisma.problemPost.findUnique({ where: { id: post.id } });
    expect(persistedPost!.deletedAt).toBeNull();

    const notifications = await notificationRepo.listRecent(commenter.userId, 10);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.type).toBe("comment_removed");
    expect(notifications[0]!.params).toMatchObject({
      problemId: problem.id,
      postTitle: post.title,
    });
  });

  it("resolve on an already-deleted post keeps the original deletion timestamp and skips the notification", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const report = await reportContent(reporter, { postId: post.id }, "already gone");
    const originalDeletedAt = new Date("2026-01-01T00:00:00.000Z");
    await testPrisma.problemPost.update({
      where: { id: post.id },
      data: { deletedAt: originalDeletedAt },
    });

    await resolveContentReport(admin, report.id, "resolve");

    const persistedPost = await testPrisma.problemPost.findUnique({ where: { id: post.id } });
    expect(persistedPost!.deletedAt).toEqual(originalDeletedAt);

    const persistedReport = await testPrisma.contentReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("resolved");

    const notifications = await notificationRepo.listRecent(author.userId, 10);
    expect(notifications).toHaveLength(0);
  });

  it("dismiss leaves the post intact and marks the report dismissed", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const report = await reportContent(reporter, { postId: post.id }, "false alarm");

    await resolveContentReport(admin, report.id, "dismiss");

    const persistedPost = await testPrisma.problemPost.findUnique({ where: { id: post.id } });
    expect(persistedPost!.deletedAt).toBeNull();

    const persistedReport = await testPrisma.contentReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("dismissed");
  });

  it("rejects acting on a report that is no longer open", async () => {
    const author = await buildActor();
    const reporter = await buildActor();
    const admin = await buildActor({ platformRole: "admin" });
    const problem = await createTestProblem();
    const post = await createPostRow(author.userId, problem.id);
    const report = await reportContent(reporter, { postId: post.id }, "dismiss me");

    await resolveContentReport(admin, report.id, "dismiss");
    await expect(resolveContentReport(admin, report.id, "resolve")).rejects.toBeInstanceOf(
      ConflictError,
    );

    const persistedPost = await testPrisma.problemPost.findUnique({ where: { id: post.id } });
    expect(persistedPost!.deletedAt).toBeNull();

    const persistedReport = await testPrisma.contentReport.findUnique({
      where: { id: report.id },
    });
    expect(persistedReport!.status).toBe("dismissed");

    const notifications = await notificationRepo.listRecent(author.userId, 10);
    expect(notifications).toHaveLength(0);
  });

  it("throws NotFoundError for a missing report", async () => {
    const admin = await buildActor({ platformRole: "admin" });
    await expect(
      resolveContentReport(admin, "report_does_not_exist", "resolve"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
