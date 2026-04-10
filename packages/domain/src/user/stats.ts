import { runTransaction, submissionRepo, userDailyActivityRepo, userStatsRepo } from "@nojv/db";

/**
 * Update the hot-path UserStats denorm row + the daily activity row for
 * the user. Per-language and per-difficulty histograms are NOT cached
 * here any more — they're computed on demand from the Submission /
 * Problem tables when the dashboard asks for them.
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

  let isFirstAc = false;
  if (isAc) {
    const acCount = await submissionRepo.count({
      userId: submission.userId,
      problemId: submission.problemId,
      status: "accepted",
      sampleOnly: false
    });
    isFirstAc = acCount === 1;
  }

  // Daily activity uses date-only midnight UTC. The repo's upsert
  // primary key is (userId, date) so callers must pre-truncate.
  const now = new Date();
  const dateOnly = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  await runTransaction(async (tx) => {
    const existing = await userStatsRepo.withTx(tx).findByUserId(submission.userId);

    if (!existing) {
      await userStatsRepo.withTx(tx).create({
        userId: submission.userId,
        totalAc: isFirstAc ? 1 : 0,
        totalAttempts: 1,
        lastSubmittedAt: now
      });
    } else {
      await userStatsRepo.withTx(tx).update(submission.userId, {
        ...(isFirstAc ? { totalAc: { increment: 1 } } : {}),
        totalAttempts: { increment: 1 },
        lastSubmittedAt: now
      });
    }

    await userDailyActivityRepo.withTx(tx).increment({
      userId: submission.userId,
      date: dateOnly,
      isAc
    });
  });
}
