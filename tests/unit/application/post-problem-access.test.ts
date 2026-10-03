import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  problem: vi.fn(),
  post: vi.fn(),
  comment: vi.fn(),
  staff: vi.fn(),
  endedAssignment: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@nojv/db", () => ({
  problemRepo: { findById: h.problem },
  courseProblemRepo: { hasStaffAccess: h.staff },
  postRepo: {
    findById: h.post,
    create: h.write,
    update: h.write,
    softDelete: h.write,
    existsForUserProblem: () => Promise.resolve(true),
  },
  postCommentRepo: { findById: h.comment, create: h.write, softDelete: h.write },
  postVoteRepo: {
    setVote: h.write,
    aggregate: () => Promise.resolve({ score: 1, viewerVote: 1 }),
  },
  contentReportRepo: { create: h.write },
  assessmentProblemRepo: {
    hasEndedAssessmentForUser: h.endedAssignment,
    findActiveAssessmentsForUser: () => Promise.resolve([]),
  },
  contestProblemRepo: {
    hasEndedContestForUser: () => Promise.resolve(false),
    findActiveContestsForUser: () => Promise.resolve([]),
  },
  examProblemRepo: {
    hasEndedExamForUser: () => Promise.resolve(false),
    findActiveExamsForUser: () => Promise.resolve([]),
  },
}));

import {
  assertCanInteractWithPosts,
  createPost,
  updatePost,
  softDeletePost,
  castPostVote,
} from "../../../packages/application/src/post/mutations";
import { addComment, softDeleteComment } from "../../../packages/application/src/post/comments";
import { reportContent } from "../../../packages/application/src/post/reports";

const actor = {
  userId: "outsider",
  username: "outsider",
  displayName: "Outsider",
  email: "outsider@example.test",
  platformRole: "student" as const,
};
const problem = { id: "problem", authorId: "owner", visibility: "private" };

beforeEach(() => {
  vi.resetAllMocks();
  h.problem.mockResolvedValue(problem);
  h.post.mockResolvedValue({
    id: "post",
    problemId: "problem",
    authorId: "other",
    type: "discussion",
    deletedAt: null,
    title: "Private discussion",
    content: "Private body",
  });
  h.comment.mockResolvedValue({
    id: "comment",
    postId: "post",
    authorId: "other",
    deletedAt: null,
  });
  h.staff.mockResolvedValue(false);
  h.endedAssignment.mockResolvedValue(false);
});

const interactions = [
  [
    "create",
    () =>
      createPost(actor, {
        problemId: "problem",
        type: "discussion",
        title: "title",
        content: "body",
      }),
  ],
  ["comment", () => addComment(actor, "post", { content: "body" })],
  ["vote", () => castPostVote(actor, "post", 1)],
  ["report post", () => reportContent(actor, { postId: "post" }, "spam")],
  ["report comment", () => reportContent(actor, { commentId: "comment" }, "spam")],
] as const;

it.each(interactions)(
  "rejects an unrelated private-problem %s before writing",
  async (_name, operation) => {
    await expect(operation()).rejects.toMatchObject({ status: 404 });
    expect(h.write).not.toHaveBeenCalled();
  },
);

it.each([
  ["edit", () => updatePost(actor, "post", { content: "changed" })],
  ["delete post", () => softDeletePost(actor, "post")],
  ["delete comment", () => softDeleteComment(actor, "comment")],
] as const)(
  "rejects own-content %s after private-problem access is revoked",
  async (_name, operation) => {
    h.post.mockResolvedValue({
      id: "post",
      problemId: "problem",
      authorId: actor.userId,
      type: "discussion",
      deletedAt: null,
    });
    h.comment.mockResolvedValue({
      id: "comment",
      postId: "post",
      authorId: actor.userId,
      deletedAt: null,
    });
    await expect(operation()).rejects.toMatchObject({ status: 404 });
    expect(h.write).not.toHaveBeenCalled();
  },
);

it.each(["author", "staff", "ended participant", "admin"])(
  "allows private-problem access for the %s",
  async (access) => {
    if (access === "author")
      h.problem.mockResolvedValue({ ...problem, authorId: actor.userId });
    if (access === "staff") h.staff.mockResolvedValue(true);
    if (access === "ended participant") h.endedAssignment.mockResolvedValue(true);
    const viewer = {
      ...actor,
      platformRole: access === "admin" ? ("admin" as const) : ("student" as const),
    };
    await expect(
      assertCanInteractWithPosts(viewer, "problem", "discussion", "blocked"),
    ).resolves.toMatchObject({ id: "problem" });
  },
);

it("hides missing problems before post creation", async () => {
  h.problem.mockResolvedValue(null);
  await expect(interactions[0][1]()).rejects.toMatchObject({ status: 404 });
  expect(h.write).not.toHaveBeenCalled();
});
