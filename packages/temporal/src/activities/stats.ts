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
