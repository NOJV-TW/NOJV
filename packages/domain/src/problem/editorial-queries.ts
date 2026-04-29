import { editorialRepo, submissionRepo } from "@nojv/db";
import type { Language } from "@nojv/core";

import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { ActorContext } from "../shared/actor-context";

export async function hasUserAcProblem(userId: string, problemId: string): Promise<boolean> {
  const count = await submissionRepo.count({
    userId,
    problemId,
    status: "accepted",
    sampleOnly: false,
  });
  return count > 0;
}

export async function upsertEditorial(
  userId: string,
  problemId: string,
  content: string,
  language: Language,
) {
  return editorialRepo.upsert(userId, problemId, { content, language });
}

export async function listProblemEditorials(problemId: string) {
  return editorialRepo.listByProblemId(problemId);
}

export interface ListEditorialsPageInput {
  problemId: string;
  page: number;
  pageSize: number;
}

/**
 * Paginated read for the dedicated editorial list page. Returns the
 * page slice plus the total count so the UI can render page controls.
 */
export async function listEditorialsPage({
  problemId,
  page,
  pageSize,
}: ListEditorialsPageInput) {
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const skip = (safePage - 1) * safeSize;
  const [items, total] = await Promise.all([
    editorialRepo.listByProblemIdPaged(problemId, skip, safeSize),
    editorialRepo.countByProblemId(problemId),
  ]);
  return { items, total, page: safePage, pageSize: safeSize };
}

/**
 * Fetch a single editorial by id. Returns null for unknown ids and for
 * soft-deleted rows alike — the caller (domain or route) maps to 404.
 */
export async function getEditorialById(id: string) {
  const row = await editorialRepo.findById(id);
  if (!row || row.deletedAt) return null;
  return row;
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
