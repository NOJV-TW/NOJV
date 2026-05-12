import { editorialRepo } from "@nojv/db";
import type { Language } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";

export async function upsertEditorial(
  userId: string,
  problemId: string,
  content: string,
  language: Language,
) {
  return editorialRepo.upsert(userId, problemId, { content, language });
}

export interface UpdateEditorialInput {
  content?: string;
  language?: Language;
}

/**
 * Permission rule: the editorial author OR a platform admin may edit.
 * Throws `NotFoundError` when the editorial is missing or already
 * soft-deleted (the actor must not be able to distinguish the two), and
 * `ForbiddenError` when the actor is a real user but lacks edit rights.
 */
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

  // Skip the write if nothing changed — keeps `updatedAt` honest.
  const changed: { content?: string; language?: Language } = {};
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

/**
 * Permission rule mirrors `updateEditorial`. Idempotency contract: a
 * second call against an already-tombstoned id surfaces as `NotFoundError`,
 * so HTTP DELETE callers see the standard 404 on the second attempt.
 */
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
