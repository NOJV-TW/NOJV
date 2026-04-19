import {
  runTransaction,
  scoreOverrideAuditLogRepo,
  scoreOverrideRepo,
  type OverrideContextType
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanSetScoreOverride } from "./authz";

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

  return runTransaction(async (tx) => {
    const row = await scoreOverrideRepo.create(tx, {
      userId: input.userId,
      problemId: input.problemId,
      contextType: input.contextType,
      contextId: input.contextId,
      overrideScore: input.overrideScore,
      reason: input.reason,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId
    });

    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: row.id,
      userId: input.userId,
      problemId: input.problemId,
      contextType: input.contextType,
      contextId: input.contextId,
      action: "create",
      oldScore: null,
      newScore: input.overrideScore,
      oldReason: null,
      newReason: input.reason,
      changedByUserId: actor.userId
    });

    return row;
  });
}

export async function updateOverride(actor: ActorContext, id: string, patch: OverridePatch) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  await assertCanSetScoreOverride(actor, existing.contextType, existing.contextId);

  if (patch.overrideScore !== undefined) validateScore(patch.overrideScore);
  if (patch.reason !== undefined) validateReason(patch.reason);

  return runTransaction(async (tx) => {
    const updated = await scoreOverrideRepo.update(tx, id, {
      ...(patch.overrideScore !== undefined ? { overrideScore: patch.overrideScore } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      updatedByUserId: actor.userId
    });

    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: id,
      userId: existing.userId,
      problemId: existing.problemId,
      contextType: existing.contextType,
      contextId: existing.contextId,
      action: "update",
      oldScore: existing.overrideScore,
      newScore: updated.overrideScore,
      oldReason: existing.reason,
      newReason: updated.reason,
      changedByUserId: actor.userId
    });

    return updated;
  });
}

export async function deleteOverride(actor: ActorContext, id: string) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  await assertCanSetScoreOverride(actor, existing.contextType, existing.contextId);

  return runTransaction(async (tx) => {
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
      changedByUserId: actor.userId
    });

    await scoreOverrideRepo.delete(tx, id);
  });
}

export async function listByContext(contextType: OverrideContextType, contextId: string) {
  return scoreOverrideRepo.listByContext(contextType, contextId);
}

export async function listAuditForContext(
  contextType: OverrideContextType,
  contextId: string,
  limit = 100
) {
  return scoreOverrideAuditLogRepo.listForContext(contextType, contextId, limit);
}

