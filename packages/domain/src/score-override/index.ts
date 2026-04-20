import {
  contestParticipationRepo,
  examParticipationRepo,
  runTransaction,
  scoreOverrideAuditLogRepo,
  scoreOverrideRepo,
  type OverrideContextType,
} from "@nojv/db";

import { updateContestScores } from "../contest/scoring";
import { updateExamScores } from "../exam/scoring";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanSetScoreOverride } from "./authz";

/**
 * Fire-and-forget scoreboard invalidation after an override mutation.
 * Contest + exam scoreboards are ZSETs in Redis that only refresh when
 * `updateContestScores` / `updateExamScores` recompute from the DB — so
 * after tweaking an override we need to re-run those for this user's
 * participation. Assignments have no cached scoreboard (class stats are
 * recomputed live), so nothing to do there.
 *
 * Errors are swallowed on purpose: the mutation already succeeded, a
 * stale Redis ZSET self-heals on the next submission, and the UI re-reads
 * overrides directly in submissions-matrix / assessment-detail.
 */
async function invalidateScoreboardForOverride(
  contextType: OverrideContextType,
  contextId: string,
  userId: string,
): Promise<void> {
  try {
    if (contextType === "contest") {
      const participationId = await contestParticipationRepo.findIdByContestAndUser(
        contextId,
        userId,
      );
      if (participationId) {
        await updateContestScores(participationId);
      }
    } else if (contextType === "exam") {
      const participationId = await examParticipationRepo.findIdByExamAndUser(
        contextId,
        userId,
      );
      if (participationId) {
        await updateExamScores(participationId);
      }
    }
    // assignment — no cached scoreboard; class stats / matrix reads
    // call resolveOverridesForContext live.
  } catch {
    // best-effort; see docstring
  }
}

export { assertCanSetScoreOverride, canSetScoreOverride } from "./authz";

export interface OverrideInput {
  userId: string;
  problemId: string;
  contextType: OverrideContextType;
  contextId: string;
  /** Non-negative integer. */
  overrideScore: number;
  /** 1-500 chars, staff-internal — never surfaced to students. */
  reason: string;
}

export type OverridePatch = Partial<Pick<OverrideInput, "overrideScore" | "reason">>;

function validateScore(score: number) {
  if (!Number.isInteger(score) || score < 0) {
    throw new ValidationError("Score must be a non-negative integer.");
  }
}

function validateReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Reason is required.");
  }
  if (reason.length > 500) {
    throw new ValidationError("Reason must be at most 500 characters.");
  }
}

export async function createOverride(actor: ActorContext, input: OverrideInput) {
  await assertCanSetScoreOverride(actor, input.contextType, input.contextId);
  validateScore(input.overrideScore);
  validateReason(input.reason);

  const row = await runTransaction(async (tx) => {
    const created = await scoreOverrideRepo.create(tx, {
      userId: input.userId,
      problemId: input.problemId,
      contextType: input.contextType,
      contextId: input.contextId,
      overrideScore: input.overrideScore,
      reason: input.reason,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    });

    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: created.id,
      userId: input.userId,
      problemId: input.problemId,
      contextType: input.contextType,
      contextId: input.contextId,
      action: "create",
      oldScore: null,
      newScore: input.overrideScore,
      oldReason: null,
      newReason: input.reason,
      changedByUserId: actor.userId,
    });

    return created;
  });

  await invalidateScoreboardForOverride(input.contextType, input.contextId, input.userId);
  return row;
}

export async function updateOverride(actor: ActorContext, id: string, patch: OverridePatch) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  await assertCanSetScoreOverride(actor, existing.contextType, existing.contextId);

  if (patch.overrideScore !== undefined) validateScore(patch.overrideScore);
  if (patch.reason !== undefined) validateReason(patch.reason);

  const updated = await runTransaction(async (tx) => {
    const row = await scoreOverrideRepo.update(tx, id, {
      ...(patch.overrideScore !== undefined ? { overrideScore: patch.overrideScore } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      updatedByUserId: actor.userId,
    });

    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: id,
      userId: existing.userId,
      problemId: existing.problemId,
      contextType: existing.contextType,
      contextId: existing.contextId,
      action: "update",
      oldScore: existing.overrideScore,
      newScore: row.overrideScore,
      oldReason: existing.reason,
      newReason: row.reason,
      changedByUserId: actor.userId,
    });

    return row;
  });

  await invalidateScoreboardForOverride(
    existing.contextType,
    existing.contextId,
    existing.userId,
  );
  return updated;
}

export async function deleteOverride(actor: ActorContext, id: string) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  await assertCanSetScoreOverride(actor, existing.contextType, existing.contextId);

  await runTransaction(async (tx) => {
    // `overrideId: null` on the audit row so the log survives the subsequent
    // delete (the FK has ON DELETE SET NULL, but setting explicitly up-front
    // keeps the intent visible and audit-stable even if the FK cascade
    // changes later).
    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: null,
      userId: existing.userId,
      problemId: existing.problemId,
      contextType: existing.contextType,
      contextId: existing.contextId,
      action: "delete",
      oldScore: existing.overrideScore,
      newScore: null,
      oldReason: existing.reason,
      newReason: null,
      changedByUserId: actor.userId,
    });

    await scoreOverrideRepo.delete(tx, id);
  });

  await invalidateScoreboardForOverride(
    existing.contextType,
    existing.contextId,
    existing.userId,
  );
}

export async function listByContext(contextType: OverrideContextType, contextId: string) {
  return scoreOverrideRepo.listByContext(contextType, contextId);
}

export async function listAuditForContext(
  contextType: OverrideContextType,
  contextId: string,
  limit = 100,
) {
  return scoreOverrideAuditLogRepo.listForContext(contextType, contextId, limit);
}
