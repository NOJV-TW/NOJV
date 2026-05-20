import { runTransaction, submissionFeedbackRepo } from "@nojv/db";
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
  return runTransaction((tx) =>
    submissionFeedbackRepo.upsert(tx, {
      ...db,
      studentUserId: input.studentUserId,
      problemId: input.problemId,
      comment: input.comment,
      authorUserId: actor.userId,
    }),
  );
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

  await runTransaction((tx) => submissionFeedbackRepo.deleteById(tx, id));
}
