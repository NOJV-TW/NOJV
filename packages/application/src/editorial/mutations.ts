import { editorialRepo, editorialVoteRepo } from "@nojv/db";
import type { Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { canViewEditorials, resolveActiveContextForUser } from "./queries";

export async function upsertEditorial(
  userId: string,
  problemId: string,
  title: string,
  content: string,
  language: Language,
) {
  return editorialRepo.upsert(userId, problemId, { title, content, language });
}

export interface UpdateEditorialInput {
  title?: string;
  content?: string;
  language?: Language;
}

export async function updateEditorial(
  actor: ActorContext,
  id: string,
  input: UpdateEditorialInput,
) {
  const existing = await editorialRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Editorial not found.");
  }

  const isAuthor = existing.userId === actor.userId;
  const isAdmin = actor.platformRole === "admin";
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError("Only the author or an admin may edit this editorial.");
  }

  const changed: { title?: string; content?: string; language?: Language } = {};
  if (input.title !== undefined && input.title !== existing.title) {
    changed.title = input.title;
  }
  if (input.content !== undefined && input.content !== existing.content) {
    changed.content = input.content;
  }
  if (input.language !== undefined && input.language !== existing.language) {
    changed.language = input.language;
  }
  if (Object.keys(changed).length === 0) {
    return existing;
  }

  return editorialRepo.update(id, changed);
}

export async function softDeleteEditorial(actor: ActorContext, id: string) {
  const existing = await editorialRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Editorial not found.");
  }

  const isAuthor = existing.userId === actor.userId;
  const isAdmin = actor.platformRole === "admin";
  if (!isAuthor && !isAdmin) {
    throw new ForbiddenError("Only the author or an admin may delete this editorial.");
  }

  return editorialRepo.softDelete(id);
}

export interface EditorialVoteResult {
  score: number;
  viewerVote: number;
}

export async function castEditorialVote(
  actor: ActorContext,
  id: string,
  value: number,
): Promise<EditorialVoteResult> {
  const existing = await editorialRepo.findById(id);
  if (!existing || existing.deletedAt) {
    throw new NotFoundError("Editorial not found.");
  }

  if (existing.userId === actor.userId) {
    throw new ForbiddenError("You cannot vote on your own editorial.");
  }

  const context = await resolveActiveContextForUser(
    actor.userId,
    existing.problemId,
    new Date(),
  );
  const canView = await canViewEditorials(actor.userId, existing.problemId, context);
  if (!canView) {
    throw new ForbiddenError("Solve this problem first to vote on editorials.");
  }

  await editorialVoteRepo.setVote(id, actor.userId, value);
  return editorialVoteRepo.aggregate(id, actor.userId);
}
