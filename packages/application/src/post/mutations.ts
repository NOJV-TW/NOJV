import { postRepo, postVoteRepo } from "@nojv/db";
import type { ProblemPostType } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { canViewPosts, resolveActiveContextForUser } from "./queries";

export interface CreatePostInput {
  type: ProblemPostType;
  problemId: string;
  title: string;
  content: string;
}

export async function createPost(actor: ActorContext, input: CreatePostInput) {
  const context = await resolveActiveContextForUser(actor.userId, input.problemId, new Date());
  const canPost = await canViewPosts(actor.userId, input.problemId, input.type, context);
  if (!canPost) {
    throw new ForbiddenError(
      input.type === "editorial"
        ? "Solve this problem first to post an editorial."
        : "You cannot post a discussion for this problem right now.",
    );
  }

  return postRepo.create({
    type: input.type,
    authorId: actor.userId,
    problemId: input.problemId,
    title: input.title,
    content: input.content,
  });
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
}

export async function updatePost(actor: ActorContext, id: string, input: UpdatePostInput) {
  const existing = await postRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Post not found.");
  }

  const isAuthor = existing.authorId === actor.userId;
  const isAdmin = actor.platformRole === "admin";
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError("Only the author or an admin may edit this post.");
  }

  const changed: { title?: string; content?: string } = {};
  if (input.title !== undefined && input.title !== existing.title) {
    changed.title = input.title;
  }
  if (input.content !== undefined && input.content !== existing.content) {
    changed.content = input.content;
  }
  if (Object.keys(changed).length === 0) {
    return existing;
  }

  return postRepo.update(id, changed);
}

export async function softDeletePost(actor: ActorContext, id: string) {
  const existing = await postRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Post not found.");
  }

  const isAuthor = existing.authorId === actor.userId;
  const isAdmin = actor.platformRole === "admin";
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError("Only the author or an admin may delete this post.");
  }

  return postRepo.softDelete(id);
}

export interface PostVoteResult {
  score: number;
  viewerVote: number;
}

export async function castPostVote(
  actor: ActorContext,
  id: string,
  value: number,
): Promise<PostVoteResult> {
  const existing = await postRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Post not found.");
  }

  if (existing.authorId === actor.userId) {
    throw new ForbiddenError("You cannot vote on your own post.");
  }

  const context = await resolveActiveContextForUser(
    actor.userId,
    existing.problemId,
    new Date(),
  );
  const canView = await canViewPosts(actor.userId, existing.problemId, existing.type, context);
  if (!canView) {
    throw new ForbiddenError("You cannot vote on this post right now.");
  }

  await postVoteRepo.setVote(id, actor.userId, value);
  return postVoteRepo.aggregate(id, actor.userId);
}
