import {
  assessmentProblemRepo,
  assessmentRepo,
  contestProblemRepo,
  contestRepo,
  courseMembershipRepo,
  durableWorkRepo,
  examProblemRepo,
  examRepo,
  participationRepo,
  runTransaction,
  scoreOverrideAuditLogRepo,
  scoreOverrideRepo,
  type TransactionClient,
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanSetScoreOverride } from "./permissions";
import { fromContextDbFields, toContextDbFields, type ScoreOverrideContext } from "./types";

export const SCORE_CONVERGENCE_WORK_KIND = "score.converge";

async function enqueueScoreConvergence(
  tx: TransactionClient,
  context: ScoreOverrideContext,
  userId: string,
  eventId: string,
): Promise<void> {
  if (context.type === "assignment") return;
  await durableWorkRepo.withTx(tx).enqueue({
    kind: SCORE_CONVERGENCE_WORK_KIND,
    dedupeKey: eventId,
    payload: { context, userId },
  });
}

async function assertScoringModeSupportsOverride(context: ScoreOverrideContext): Promise<void> {
  let scoringMode: string;
  if (context.type === "contest") {
    ({ scoringMode } = await contestRepo.findInfoById(context.contestId));
  } else if (context.type === "exam") {
    ({ scoringMode } = await examRepo.findInfoById(context.examId));
  } else {
    return;
  }
  if (scoringMode !== "point_sum") {
    throw new ValidationError(
      "Score overrides are only supported for point-sum (partial-credit) scoring.",
    );
  }
}

async function assertProblemAndUserInContext(
  context: ScoreOverrideContext,
  problemId: string,
  userId: string,
): Promise<void> {
  switch (context.type) {
    case "contest": {
      const [problemInContext, participation] = await Promise.all([
        contestProblemRepo.existsById(context.contestId, problemId),
        participationRepo.findContestParticipation(context.contestId, userId),
      ]);
      if (!problemInContext) {
        throw new NotFoundError("Problem is not part of this contest.");
      }
      if (!participation) {
        throw new NotFoundError("User is not a participant in this contest.");
      }
      break;
    }
    case "exam": {
      const [problemInContext, participation] = await Promise.all([
        examProblemRepo.exists(context.examId, problemId),
        participationRepo.findExamParticipation(context.examId, userId),
      ]);
      if (!problemInContext) {
        throw new NotFoundError("Problem is not part of this exam.");
      }
      if (!participation) {
        throw new NotFoundError("User is not a participant in this exam.");
      }
      break;
    }
    case "assignment": {
      const assessment = await assessmentRepo.findByIdWithCourseId(context.assignmentId);
      if (!assessment) {
        throw new NotFoundError("Assignment not found.");
      }
      const [problemInContext, membership] = await Promise.all([
        assessmentProblemRepo.exists(context.assignmentId, problemId),
        courseMembershipRepo.findByComposite(assessment.courseId, userId),
      ]);
      if (!problemInContext) {
        throw new NotFoundError("Problem is not part of this assignment.");
      }
      if (membership?.status !== "active") {
        throw new NotFoundError("User is not enrolled in this course.");
      }
      break;
    }
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
  await assertProblemAndUserInContext(input.context, input.problemId, input.userId);

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

    const audit = await scoreOverrideAuditLogRepo.create(tx, {
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
    await enqueueScoreConvergence(tx, input.context, input.userId, audit.id);

    return created;
  });
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

    const audit = await scoreOverrideAuditLogRepo.create(tx, {
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
    await enqueueScoreConvergence(tx, existingContext, existing.userId, audit.id);

    return row;
  });
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
    const audit = await scoreOverrideAuditLogRepo.create(tx, {
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
    await enqueueScoreConvergence(tx, existingContext, existing.userId, audit.id);
  });
}
