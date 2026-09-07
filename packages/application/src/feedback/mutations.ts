import {
  runTransaction,
  submissionFeedbackAuditLogRepo,
  submissionFeedbackRepo,
} from "@nojv/db";
import { feedbackUpsertSchema, type FeedbackUpsertInput } from "@nojv/core";

import {
  assertCourseGradingSubject,
  lockCourseGradingContext,
} from "../scoring/course-grading";
import type { ActorContext } from "../shared/actor-context";
import { NotFoundError, ValidationError } from "../shared/errors";
import { assertCanWriteFeedback } from "./permissions";
import { fromContextDbFields, toContextDbFields, type FeedbackContext } from "./types";

export async function upsertFeedback(
  actor: ActorContext,
  { context, input }: { context: FeedbackContext; input: FeedbackUpsertInput },
) {
  await assertCanWriteFeedback(actor, context);
  const parsed = feedbackUpsertSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.message);
  input = parsed.data;

  const db = toContextDbFields(context);
  const data = {
    ...db,
    courseMembershipId: input.courseMembershipId,
    problemId: input.problemId,
    comment: input.comment,
    authorUserId: actor.userId,
  };

  return runTransaction(async (tx) => {
    const courseId = await lockCourseGradingContext(tx, context, actor);
    const membership = await assertCourseGradingSubject(
      tx,
      courseId,
      context,
      input.problemId,
      input.courseMembershipId,
    );
    const existing = await submissionFeedbackRepo.findExistingForUpsert(tx, data);
    const row = await submissionFeedbackRepo.upsert(tx, data);

    await submissionFeedbackAuditLogRepo.create(tx, {
      feedbackId: row.id,
      studentUserId: membership.userId,
      courseMembershipId: membership.id,
      sourceMembershipId: membership.id,
      problemId: input.problemId,
      assessmentId: db.assessmentId ?? null,
      examId: db.examId ?? null,
      action: existing ? "update" : "create",
      oldComment: existing?.comment ?? null,
      newComment: input.comment,
      changedByUserId: actor.userId,
    });

    return row;
  });
}

export async function deleteFeedback(actor: ActorContext, id: string) {
  const existing = await submissionFeedbackRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Submission feedback not found.");
  }
  const context = fromContextDbFields(existing);
  await assertCanWriteFeedback(actor, context);

  await runTransaction(async (tx) => {
    const courseId = await lockCourseGradingContext(tx, context, actor);
    const current = await submissionFeedbackRepo.findById(id, tx);
    if (!current) throw new NotFoundError("Submission feedback not found.");
    const membership = await assertCourseGradingSubject(
      tx,
      courseId,
      context,
      current.problemId,
      current.courseMembershipId,
    );
    await submissionFeedbackAuditLogRepo.create(tx, {
      feedbackId: existing.id,
      studentUserId: membership.userId,
      courseMembershipId: membership.id,
      sourceMembershipId: membership.id,
      problemId: existing.problemId,
      assessmentId: existing.assessmentId,
      examId: existing.examId,
      action: "delete",
      oldComment: current.comment,
      newComment: null,
      changedByUserId: actor.userId,
    });
    await submissionFeedbackRepo.deleteById(tx, id);
  });
}
