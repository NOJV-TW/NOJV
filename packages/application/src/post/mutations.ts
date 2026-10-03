import { postRepo, postVoteRepo, problemRepo } from "@nojv/db";
import type { ProblemPostType } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { canViewPosts, contextGateOpen, resolveActiveContextForUser } from "./queries";
import { assertProblemViewAccess, type ProblemActorContext } from "../problem/permissions";

export async function assertPostProblemViewAccess(
  actor: ProblemActorContext,
  problemId: string,
) {
  const problem = await problemRepo.findById(problemId);
  if (!problem) throw new NotFoundError("Problem not found.");
  await assertProblemViewAccess(problem, actor);
  return problem;
}

export async function assertCanInteractWithPosts(
  actor: ProblemActorContext,
  problemId: string,
  type: ProblemPostType,
  message: string,
) {
  const problem = await assertPostProblemViewAccess(actor, problemId);
  if (actor.platformRole === "admin") return problem;
  const { userId } = actor;
  const context = await resolveActiveContextForUser(userId, problemId, new Date());
  if (!(await contextGateOpen(context))) {
    throw new ForbiddenError(
      "Posts are unavailable until the active contest, assignment, or exam ends.",
    );
  }
  const allowed = await canViewPosts(userId, problemId, type);
  if (!allowed) {
    throw new ForbiddenError(message);
  }
  return problem;
}

export function assertAuthorOrAdmin(actor: ActorContext, authorId: string, message: string) {
  if (actor.userId !== authorId && actor.platformRole !== "admin") {
    throw new ForbiddenError(message);
  }
}

export interface CreatePostInput {
  type: ProblemPostType;
  problemId: string;
  title: string;
  content: string;
}

export async function createPost(actor: ActorContext, input: CreatePostInput) {
  await assertCanInteractWithPosts(
    actor,
    input.problemId,
    input.type,
    input.type === "editorial"
      ? "Solve this problem first to post an editorial."
      : "You cannot post a discussion for this problem right now.",
  );

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

  await assertPostProblemViewAccess(actor, existing.problemId);
  assertAuthorOrAdmin(
    actor,
    existing.authorId,
    "Only the author or an admin may edit this post.",
  );

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

  await assertPostProblemViewAccess(actor, existing.problemId);
  assertAuthorOrAdmin(
    actor,
    existing.authorId,
    "Only the author or an admin may delete this post.",
  );

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

  await assertCanInteractWithPosts(
    actor,
    existing.problemId,
    existing.type,
    "You cannot vote on this post right now.",
  );

  await postVoteRepo.setVote(id, actor.userId, value);
  return postVoteRepo.aggregate(id, actor.userId);
}
