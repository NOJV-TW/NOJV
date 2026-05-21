import {
  runTransaction,
  submissionFeedbackAuditLogRepo,
  submissionFeedbackRepo,
} from "@nojv/db";
import type { FeedbackUpsertInput } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { NotFoundError } from "../shared/errors";
import { assertCanWriteFeedback } from "./permissions";
import { fromContextDbFields, toContextDbFields, type FeedbackContext } from "./types";

/**
 * Create or update grading feedback for a `(student, problem, context)`
 * triple. The repo `upsert` keys on that triple, so re-calling with the
 * same triple edits the existing row instead of inserting a second.
 *
 * `input` is an already-parsed `FeedbackUpsertInput` (validated by
 * `feedbackUpsertSchema` at the API boundary).
 */
export async function upsertFeedback(
  actor: ActorContext,
  { context, input }: { context: FeedbackContext; input: FeedbackUpsertInput },
) {
  await assertCanWriteFeedback(actor, context);

  const db = toContextDbFields(context);
  const data = {
    ...db,
    studentUserId: input.studentUserId,
    problemId: input.problemId,
    comment: input.comment,
    authorUserId: actor.userId,
  };

  return runTransaction(async (tx) => {
    const existing = await submissionFeedbackRepo.findExistingForUpsert(tx, data);
    const row = await submissionFeedbackRepo.upsert(tx, data);

    await submissionFeedbackAuditLogRepo.create(tx, {
      feedbackId: row.id,
      studentUserId: input.studentUserId,
      problemId: input.problemId,
      courseAssessmentId: db.courseAssessmentId ?? null,
      examId: db.examId ?? null,
      action: existing ? "update" : "create",
      oldComment: existing?.comment ?? null,
      newComment: input.comment,
      changedByUserId: actor.userId,
    });

    return row;
  });
}

/**
 * Delete a feedback row. Fetches the row first to derive its context, then
 * asserts the actor may write feedback there (which also re-checks the
 * post-close gate).
 */
export async function deleteFeedback(actor: ActorContext, id: string) {
  const existing = await submissionFeedbackRepo.findById(id);
  if (!existing) {
    throw new NotFoundError("Submission feedback not found.");
  }
  await assertCanWriteFeedback(actor, fromContextDbFields(existing));

  await runTransaction(async (tx) => {
    // Write audit before delete so the FK still resolves to the live row.
    await submissionFeedbackAuditLogRepo.create(tx, {
      feedbackId: existing.id,
      studentUserId: existing.studentUserId,
      problemId: existing.problemId,
      courseAssessmentId: existing.courseAssessmentId,
      examId: existing.examId,
      action: "delete",
      oldComment: existing.comment,
      newComment: null,
      changedByUserId: actor.userId,
    });
    await submissionFeedbackRepo.deleteById(tx, id);
  });
}
