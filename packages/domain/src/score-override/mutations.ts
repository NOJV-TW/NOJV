import {
  contestParticipationRepo,
  contestRepo,
  examParticipationRepo,
  examRepo,
  runTransaction,
  scoreOverrideAuditLogRepo,
  scoreOverrideRepo,
} from "@nojv/db";

import { updateContestScores } from "../contest/scoring";
import { updateExamScores } from "../exam/scoring";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanSetScoreOverride } from "./permissions";
import { fromContextDbFields, toContextDbFields, type ScoreOverrideContext } from "./types";

async function invalidateScoreboardForOverride(
  context: ScoreOverrideContext,
  userId: string,
): Promise<void> {
  try {
    if (context.type === "contest") {
      const participationId = await contestParticipationRepo.findIdByContestAndUser(
        context.contestId,
        userId,
      );
      if (participationId) {
        await updateContestScores(participationId);
      }
    } else if (context.type === "exam") {
      const participationId = await examParticipationRepo.findIdByExamAndUser(
        context.examId,
        userId,
      );
      if (participationId) {
        await updateExamScores(participationId);
      }
    }
  } catch {
    // best-effort; see docstring
  }
}

async function assertScoringModeSupportsOverride(context: ScoreOverrideContext): Promise<void> {
  // ICPC-style (problem_count) scoreboards rank by solved-count + penalty, so a
  // per-problem point override has no defined meaning and is silently dropped by
  // the scoring pipeline (only the point_sum branch merges overrides). Reject it
  // loudly here instead of persisting a no-op the teacher believes took effect.
  let scoringMode: string;
  if (context.type === "contest") {
    ({ scoringMode } = await contestRepo.findInfoById(context.contestId));
  } else if (context.type === "exam") {
    ({ scoringMode } = await examRepo.findInfoById(context.examId));
  } else {
    return;
  }
  if (scoringMode === "problem_count") {
    throw new ValidationError(
      "Score overrides are not supported for ICPC-style (problem-count) scoring.",
    );
  }
}

export interface OverrideInput {
  userId: string;
  problemId: string;
  context: ScoreOverrideContext;
  overrideScore: number;
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
  await assertCanSetScoreOverride(actor, input.context);
  validateScore(input.overrideScore);
  validateReason(input.reason);
  await assertScoringModeSupportsOverride(input.context);

  const db = toContextDbFields(input.context);
  const row = await runTransaction(async (tx) => {
    const created = await scoreOverrideRepo.create(tx, {
      userId: input.userId,
      problemId: input.problemId,
      contextType: db.contextType,
      contextId: db.contextId,
      overrideScore: input.overrideScore,
      reason: input.reason,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    });

    await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: created.id,
      userId: input.userId,
      problemId: input.problemId,
      contextType: db.contextType,
      contextId: db.contextId,
      action: "create",
      oldScore: null,
      newScore: input.overrideScore,
      oldReason: null,
      newReason: input.reason,
      changedByUserId: actor.userId,
    });

    return created;
  });

  await invalidateScoreboardForOverride(input.context, input.userId);
  return row;
}

export async function updateOverride(actor: ActorContext, id: string, patch: OverridePatch) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  const existingContext = fromContextDbFields(existing);
  await assertCanSetScoreOverride(actor, existingContext);

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

  await invalidateScoreboardForOverride(existingContext, existing.userId);
  return updated;
}

export async function deleteOverride(actor: ActorContext, id: string) {
  const existing = await scoreOverrideRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Score override not found.");
  }
  const existingContext = fromContextDbFields(existing);
  await assertCanSetScoreOverride(actor, existingContext);

  await runTransaction(async (tx) => {
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

  await invalidateScoreboardForOverride(existingContext, existing.userId);
}
