import { contestDomain } from "@nojv/domain";

export type ContestInfo = contestDomain.ContestLifecycleInfo;

export async function getContestInfo(contestId: string): Promise<ContestInfo> {
  return contestDomain.getContestLifecycleInfo(contestId);
}

export async function activateContest(contestId: string): Promise<void> {
  await contestDomain.activateContest(contestId);
}

export async function freezeScoreboard(contestId: string): Promise<void> {
  await contestDomain.freezeContestBoard(contestId);
}

export async function finalizeContest(contestId: string): Promise<void> {
  await contestDomain.finalizeContest(contestId);
}

export async function updateContestScores(contestParticipationId: string): Promise<void> {
  await contestDomain.updateContestScores(contestParticipationId);
}
