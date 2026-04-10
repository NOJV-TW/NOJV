import { userDailyActivityRepo } from "@nojv/db";

// Name is load-bearing: Temporal registers activities by string, so renaming
// this function would force a workflow version bump.
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
