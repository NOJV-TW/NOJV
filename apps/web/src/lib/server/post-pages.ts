import { error } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import type { ProblemPostType } from "@nojv/core";
import { postDomain, problemDomain } from "@nojv/application";

import { requireAuth, type CompletedActorContext } from "$lib/server/auth";

const { canViewPosts, getPostById, listComments, listPostsPage, resolveActiveContextForUser } =
  postDomain;
const { getProblemRowById } = problemDomain;

const PAGE_SIZE = 20;

const FORBIDDEN_MESSAGES: Record<ProblemPostType, string> = {
  editorial: "Solve this problem first to view editorials.",
  discussion: "You cannot view discussions for this problem right now.",
};

interface PostRouteEvent extends Pick<RequestEvent, "locals"> {
  params: { problemId: string };
  url: URL;
}

interface PostDetailRouteEvent extends Pick<RequestEvent, "locals"> {
  params: { problemId: string; postId: string };
  url: URL;
}

interface ProblemMini {
  id: string;
  displayId: number | null;
  title: string;
}

async function gatePostPage(
  event: PostRouteEvent,
  type: ProblemPostType,
): Promise<{ actor: CompletedActorContext; problem: ProblemMini }> {
  const actor = requireAuth(event);
  const problem = await getProblemRowById(event.params.problemId);
  if (!problem) {
    error(404, "Problem not found.");
  }
  if (actor.platformRole !== "admin") {
    const context = await resolveActiveContextForUser(actor.userId, problem.id, new Date());
    const canView = await canViewPosts(actor.userId, problem.id, type, context);
    if (!canView) {
      error(403, FORBIDDEN_MESSAGES[type]);
    }
  }
  return {
    actor,
    problem: { id: problem.id, displayId: problem.displayId, title: problem.title },
  };
}

async function requireRoutedPost(
  event: PostDetailRouteEvent,
  type: ProblemPostType,
  actor: CompletedActorContext,
) {
  const post = await getPostById(event.params.postId, actor.userId);
  if (post?.problemId !== event.params.problemId || post.type !== type) {
    error(404, "Post not found.");
  }
  return post;
}

function actorSummary(actor: CompletedActorContext) {
  return { userId: actor.userId, platformRole: actor.platformRole };
}

export async function loadPostListPage(event: PostRouteEvent, type: ProblemPostType) {
  const { actor, problem } = await gatePostPage(event, type);

  const pageParam = event.url.searchParams.get("page");
  const requestedPage = pageParam ? Number.parseInt(pageParam, 10) : 1;
  const requested = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const { items, total, page, pageSize } = await listPostsPage({
    problemId: problem.id,
    type,
    viewerId: actor.userId,
    page: requested,
    pageSize: PAGE_SIZE,
  });

  return {
    type,
    problem,
    actor: actorSummary(actor),
    posts: items.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      author: { username: row.author.username, name: row.author.name },
      voteScore: row.voteScore,
      commentCount: row.commentCount,
    })),
    total,
    page,
    pageSize,
  };
}

export async function loadPostArticlePage(event: PostDetailRouteEvent, type: ProblemPostType) {
  const { actor, problem } = await gatePostPage(event, type);
  const post = await requireRoutedPost(event, type, actor);
  const comments = await listComments(post.id);

  return {
    type,
    problem,
    actor: actorSummary(actor),
    post: {
      id: post.id,
      type: post.type,
      title: post.title,
      content: post.content,
      createdAt: post.createdAt.toISOString(),
      authorId: post.authorId,
      author: { username: post.author.username, name: post.author.name },
      voteScore: post.voteScore,
      viewerVote: post.viewerVote,
    },
    comments: comments.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      authorId: row.authorId,
      author: { username: row.author.username, name: row.author.name },
      deleted: row.deleted,
    })),
  };
}

export async function loadPostComposePage(event: PostRouteEvent, type: ProblemPostType) {
  const { problem } = await gatePostPage(event, type);
  return { type, problem };
}

export async function loadPostEditPage(event: PostDetailRouteEvent, type: ProblemPostType) {
  const { actor, problem } = await gatePostPage(event, type);
  const post = await requireRoutedPost(event, type, actor);
  if (post.authorId !== actor.userId && actor.platformRole !== "admin") {
    error(403, "Only the author or an admin may edit this post.");
  }
  return {
    type,
    problem,
    post: { id: post.id, title: post.title, content: post.content },
  };
}
