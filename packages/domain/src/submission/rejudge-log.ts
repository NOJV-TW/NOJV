import { submissionRejudgeLogRepo, submissionRepo } from "@nojv/db";

import { toJsonValue } from "../shared/to-json-value";

/**
 * Two-pass audit for rejudges.
 *
 * `snapshotForRejudge` writes a log row with the pre-rejudge state
 * before the sandbox runs; `finalizeRejudgeLog` fills in the post-
 * rejudge fields after `completeSubmission` writes the new verdict.
 *
 * The two passes are deliberately separate: the snapshot must see the
 * pre-rejudge row, and `completeSubmission` overwrites it in place.
 * new* columns are nullable so the snapshot is a valid standalone
 * row if the workflow dies between the two calls (Temporal retries
 * land on the already-snapshotted row rather than duplicating).
 */
export async function snapshotForRejudge(
  submissionId: string,
  triggeredByUserId: string | null,
): Promise<{ logId: string } | null> {
  const current = await submissionRepo.findById(submissionId);
  if (!current) return null;

  const row = await submissionRejudgeLogRepo.create({
    submissionId,
    rejudgedByUserId: triggeredByUserId,
    oldVerdict: current.status,
    oldScore: current.score,
    oldResultJson: current.verdictDetail === null ? null : toJsonValue(current.verdictDetail),
  });

  return { logId: row.id };
}

export async function finalizeRejudgeLog(
  submissionId: string,
  _triggeredByUserId: string | null,
  logId: string,
): Promise<void> {
  const updated = await submissionRepo.findById(submissionId);
  if (!updated) return;

  await submissionRejudgeLogRepo.update(logId, {
    newVerdict: updated.status,
    newScore: updated.score,
    newResultJson: updated.verdictDetail === null ? null : toJsonValue(updated.verdictDetail),
  });
}
