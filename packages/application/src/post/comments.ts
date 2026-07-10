import { postCommentRepo, postRepo } from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertAuthorOrAdmin, assertCanInteractWithPosts } from "./mutations";

export interface AddCommentInput {
  content: string;
  parentId?: string | null;
}

export async function addComment(actor: ActorContext, postId: string, input: AddCommentInput) {
  const post = await postRepo.findById(postId);
  if (!post || post.deletedAt) {
    throw new NotFoundError("Post not found.");
  }

  await assertCanInteractWithPosts(
    actor.userId,
    post.problemId,
    post.type,
    "You cannot comment on this post right now.",
  );

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await postCommentRepo.findById(parentId);
    if (parent?.postId !== postId) {
      throw new ValidationError("Parent comment not found.");
    }
    if (parent.parentId) {
      throw new ValidationError("Replies cannot be nested deeper than one level.");
    }
  }

  return postCommentRepo.create({
    postId,
    authorId: actor.userId,
    parentId,
    content: input.content,
  });
}

export async function softDeleteComment(actor: ActorContext, commentId: string) {
  const existing = await postCommentRepo.findById(commentId);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Comment not found.");
  }

  assertAuthorOrAdmin(
    actor,
    existing.authorId,
    "Only the author or an admin may delete this comment.",
  );

  return postCommentRepo.softDelete(commentId);
}

export async function listComments(postId: string) {
  const rows = await postCommentRepo.listByPostId(postId);
  return rows.map((row) =>
    row.deletedAt ? { ...row, content: "", deleted: true } : { ...row, deleted: false },
  );
}
