import { userDailyActivityRepo } from "@nojv/db";

/**
 * Record a finished submission's contribution to the daily-activity graph.
 * The `UserStats` denorm row was removed in the second-pass refactor — the
 * dashboard now aggregates `totalAc` / `totalAttempts` / `lastSubmittedAt`
 * from the `Submission` table on demand. Daily activity remains its own
 * table because it powers the GitHub-style contribution graph, which is
 * expensive to compute ad-hoc.
 *
 * The function name is kept for workflow-registration stability — Temporal
 * looks activities up by string, so renaming would require a workflow
 * version bump.
 */
export async function updateUserStats(submission: {
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  status: string;
  userId: string;
}): Promise<void> {
  if (submission.sampleOnly) return;

  const isAc = submission.status === "accepted";

  // Daily activity uses date-only midnight UTC. The repo's upsert primary
  // key is (userId, date) so callers must pre-truncate.
  const now = new Date();
  const dateOnly = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  await userDailyActivityRepo.increment({
    userId: submission.userId,
    date: dateOnly,
    isAc
  });
}
