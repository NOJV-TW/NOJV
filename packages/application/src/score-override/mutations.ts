import {
  durableWorkRepo,
  examRepo,
  participationRepo,
  runTransaction,
  scoreOverrideAuditLogRepo,
  scoreOverrideRepo,
  type TransactionClient,
} from "@nojv/db";

import { scoreOverrideCreateSchema, type ScoreOverrideCreateInput } from "@nojv/core";

import {
  assertCourseGradingSubject,
  lockCourseGradingContext,
} from "../scoring/course-grading";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanSetScoreOverride } from "./permissions";
import { fromContextDbFields, toContextDbFields, type ScoreOverrideContext } from "./types";

export const SCORE_CONVERGENCE_WORK_KIND = "score.converge";

async function enqueueScoreConvergence(
  tx: TransactionClient,
  context: ScoreOverrideContext,
  userId: string | null,
  eventId: string,
): Promise<void> {
  if (context.type === "assignment" || userId === null) return;
  if (!(await participationRepo.withTx(tx).findExamParticipation(context.examId, userId)))
    return;
  await durableWorkRepo.withTx(tx).enqueue({
    kind: SCORE_CONVERGENCE_WORK_KIND,
    dedupeKey: eventId,
    payload: { context, userId },
  });
}

async function assertScoringModeSupportsOverride(
  tx: TransactionClient,
  context: ScoreOverrideContext,
): Promise<void> {
  if (context.type === "assignment") return;
  const row = await examRepo.withTx(tx).findById(context.examId);
  if (!row) throw new NotFoundError("Grading context not found.");
  if (row.scoringMode !== "point_sum")
    throw new ValidationError(
      "Score overrides are only supported for point-sum (partial-credit) scoring.",
    );
}

async function resolveSubject(
  tx: TransactionClient,
  context: ScoreOverrideContext,
  problemId: string,
  courseMembershipId: string | null,
  courseId: string,
): Promise<string | null> {
  if (!courseMembershipId) {
    throw new ValidationError("Course overrides require a course membership ID.");
  }
  const membership = await assertCourseGradingSubject(
    tx,
    courseId,
    context,
    problemId,
    courseMembershipId,
  );
  return membership.userId;
}

export type OverrideInput = ScoreOverrideCreateInput;

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
  const parsed = scoreOverrideCreateSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.message);
  input = parsed.data;
  await assertCanSetScoreOverride(actor, input.context);

  const db = toContextDbFields(input.context);
  const row = await runTransaction(async (tx) => {
    const courseId = await lockCourseGradingContext(tx, input.context, actor);
    await assertScoringModeSupportsOverride(tx, input.context);
    const userId = await resolveSubject(
      tx,
      input.context,
      input.problemId,
      input.courseMembershipId,
      courseId,
    );
    const created = await scoreOverrideRepo.create(tx, {
      courseMembershipId: input.courseMembershipId,
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
      userId,
      courseMembershipId: input.courseMembershipId,
      sourceMembershipId: input.courseMembershipId,
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
    await enqueueScoreConvergence(tx, input.context, userId, audit.id);

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
    const courseId = await lockCourseGradingContext(tx, existingContext, actor);
    await assertScoringModeSupportsOverride(tx, existingContext);
    const current = await scoreOverrideRepo.findById(id, tx);
    if (!current) throw new NotFoundError("Score override not found.");
    const userId = await resolveSubject(
      tx,
      existingContext,
      current.problemId,
      current.courseMembershipId,
      courseId,
    );
    const row = await scoreOverrideRepo.update(tx, id, {
      ...(patch.overrideScore !== undefined ? { overrideScore: patch.overrideScore } : {}),
      ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
      updatedByUserId: actor.userId,
    });

    const audit = await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: id,
      userId,
      courseMembershipId: current.courseMembershipId,
      sourceMembershipId: current.courseMembershipId,
      problemId: existing.problemId,
      contextType: existing.contextType,
      contextId: existing.contextId,
      action: "update",
      oldScore: current.overrideScore,
      newScore: row.overrideScore,
      oldReason: current.reason,
      newReason: row.reason,
      changedByUserId: actor.userId,
    });
    await enqueueScoreConvergence(tx, existingContext, userId, audit.id);

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
    const courseId = await lockCourseGradingContext(tx, existingContext, actor);
    const current = await scoreOverrideRepo.findById(id, tx);
    if (!current) throw new NotFoundError("Score override not found.");
    const userId = await resolveSubject(
      tx,
      existingContext,
      current.problemId,
      current.courseMembershipId,
      courseId,
    );
    const audit = await scoreOverrideAuditLogRepo.create(tx, {
      overrideId: null,
      userId,
      courseMembershipId: current.courseMembershipId,
      sourceMembershipId: current.courseMembershipId,
      problemId: existing.problemId,
      contextType: existing.contextType,
      contextId: existing.contextId,
      action: "delete",
      oldScore: current.overrideScore,
      newScore: null,
      oldReason: current.reason,
      newReason: null,
      changedByUserId: actor.userId,
    });

    await scoreOverrideRepo.delete(tx, id);
    await enqueueScoreConvergence(tx, existingContext, userId, audit.id);
  });
}
