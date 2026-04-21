import { userDomain } from "@nojv/domain";

export async function updateUserStats(submission: {
  id: string;
  language: string;
  problemId: string;
  sampleOnly: boolean;
  status: string;
  userId: string;
}): Promise<void> {
  await userDomain.updateUserStats(submission);
}

export async function adjustUserStatsForRejudge(
  submission: {
    createdAt: Date;
    sampleOnly: boolean;
    status: string;
    userId: string;
  },
  oldStatus: string,
): Promise<void> {
  await userDomain.adjustUserStatsForRejudge(submission, oldStatus);
}
