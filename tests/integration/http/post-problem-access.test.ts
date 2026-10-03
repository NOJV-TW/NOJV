import { describe, expect, it, vi } from "vitest";

import {
  createTestContest,
  createTestProblem,
  createTestUser,
  testPrisma,
} from "../../fixtures/factories";
import { callRoute } from "./_harness";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("$lib/auth.server", () => ({
  getAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get("x-test-user-id");
        if (!userId) return null;
        const { testPrisma } = await import("../../fixtures/factories");
        const user = await testPrisma.user.findUnique({ where: { id: userId } });
        return user
          ? { session: { id: "post-access-session", createdAt: new Date(), userId }, user }
          : null;
      },
    },
  }),
}));

const problemPosts =
  await import("../../../apps/web/src/routes/api/problems/[id]/posts/+server");
const posts = await import("../../../apps/web/src/routes/api/posts/[id]/+server");
const comments = await import("../../../apps/web/src/routes/api/posts/[id]/comments/+server");
const votes = await import("../../../apps/web/src/routes/api/posts/[id]/votes/+server");
const postReports = await import("../../../apps/web/src/routes/api/posts/[id]/reports/+server");
const commentItem = await import("../../../apps/web/src/routes/api/comments/[id]/+server");
const commentReports =
  await import("../../../apps/web/src/routes/api/comments/[id]/reports/+server");

async function privateDiscussion() {
  const owner = await createTestUser();
  const problem = await createTestProblem({ authorId: owner.id, visibility: "private" });
  const post = await testPrisma.problemPost.create({
    data: {
      problemId: problem.id,
      authorId: owner.id,
      type: "discussion",
      title: "Private title",
      content: "Private solution body",
    },
  });
  return { owner, problem, post };
}

describe("problem posts preserve the parent problem's visibility", () => {
  it("hides private post reads and interactions from unrelated sessions, including inactive admins", async () => {
    const { owner, problem, post } = await privateDiscussion();
    const outsider = await createTestUser();
    const inactiveAdmin = await createTestUser({ platformRole: "admin" });
    const comment = await testPrisma.postComment.create({
      data: { postId: post.id, authorId: owner.id, content: "Private comment" },
    });
    const requests = [
      {
        path: `/api/problems/${problem.id}/posts?type=discussion`,
        module: problemPosts,
        params: { id: problem.id },
      },
      {
        path: `/api/problems/${problem.id}/posts?type=editorial`,
        module: problemPosts,
        params: { id: problem.id },
      },
      { path: `/api/posts/${post.id}`, module: posts, params: { id: post.id } },
      { path: `/api/posts/${post.id}/comments`, module: comments, params: { id: post.id } },
      {
        path: `/api/posts/${post.id}`,
        module: posts,
        params: { id: post.id },
        method: "PATCH",
        body: { content: "An unauthorized edit" },
      },
      {
        path: `/api/posts/${post.id}`,
        module: posts,
        params: { id: post.id },
        method: "DELETE",
      },
      {
        path: `/api/comments/${comment.id}`,
        module: commentItem,
        params: { id: comment.id },
        method: "DELETE",
      },
      {
        path: `/api/problems/${problem.id}/posts`,
        module: problemPosts,
        params: { id: problem.id },
        method: "POST",
        body: { type: "discussion", title: "New post", content: "An unauthorized discussion" },
      },
      {
        path: `/api/posts/${post.id}/comments`,
        module: comments,
        params: { id: post.id },
        method: "POST",
        body: { content: "An unauthorized comment" },
      },
      {
        path: `/api/posts/${post.id}/votes`,
        module: votes,
        params: { id: post.id },
        method: "POST",
        body: { value: 1 },
      },
      {
        path: `/api/posts/${post.id}/reports`,
        module: postReports,
        params: { id: post.id },
        method: "POST",
        body: { reason: "spam" },
      },
      {
        path: `/api/comments/${comment.id}/reports`,
        module: commentReports,
        params: { id: comment.id },
        method: "POST",
        body: { reason: "spam" },
      },
    ];
    for (const user of [outsider, inactiveAdmin]) {
      for (const request of requests) {
        const response = await callRoute({ ...request, user });
        expect(response.status, `${user.platformRole}: ${request.path}`).toBe(404);
        expect(await response.text()).not.toContain("Private solution body");
      }
    }
    expect(await testPrisma.problemPost.count({ where: { problemId: problem.id } })).toBe(1);
    expect(await testPrisma.postComment.count({ where: { postId: post.id } })).toBe(1);
    expect(await testPrisma.postVote.count()).toBe(0);
    expect(await testPrisma.contentReport.count()).toBe(0);
  });

  it("allows the private problem's author to read and create discussions", async () => {
    const { owner, problem, post } = await privateDiscussion();
    const read = await callRoute({
      path: `/api/posts/${post.id}`,
      module: posts,
      params: { id: post.id },
      user: owner,
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ content: "Private solution body" });
    const created = await callRoute({
      path: `/api/problems/${problem.id}/posts`,
      module: problemPosts,
      params: { id: problem.id },
      user: owner,
      method: "POST",
      body: {
        type: "discussion",
        title: "Another discussion",
        content: "The author can still discuss this problem.",
      },
    });
    expect(created.status).toBe(201);
    expect(await testPrisma.problemPost.count({ where: { problemId: problem.id } })).toBe(2);
  });

  it("allows historical participants after a private contest ends", async () => {
    const { problem } = await privateDiscussion();
    const participant = await createTestUser();
    const contest = await createTestContest({
      startsAt: new Date(Date.now() - 120_000),
      endsAt: new Date(Date.now() - 60_000),
    });
    await testPrisma.contestProblem.create({
      data: { contestId: contest.id, problemId: problem.id, ordinal: 1 },
    });
    await testPrisma.participation.create({
      data: {
        type: "contest",
        contestId: contest.id,
        userId: participant.id,
        status: "submitted",
      },
    });
    const response = await callRoute({
      path: `/api/problems/${problem.id}/posts?type=discussion`,
      module: problemPosts,
      params: { id: problem.id },
      user: participant,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ total: 1 });
  });
});
