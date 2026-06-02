import { contestDomain, examDomain, notificationDomain } from "@nojv/domain";
import { pubsub } from "@nojv/redis";

export type ContestInfo = contestDomain.ContestLifecycleSnapshot;

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

export async function updateExamScores(examId: string, userId: string): Promise<void> {
  await examDomain.updateExamScoresForUser(examId, userId);
}

export async function closeActiveSessionsForExam(examId: string): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(examId);
}

export const publishVerdict = pubsub.publishVerdict;
export const publishContestEvent = pubsub.publishContestEvent;
export const publishAssessmentDeadline = pubsub.publishAssessmentDeadline;

export async function fanoutAssignmentDueSoon(assignmentId: string): Promise<void> {
  await notificationDomain.fanoutAssignmentDueSoon(assignmentId);
}

export async function fanoutExamStartingSoon(examId: string): Promise<void> {
  await notificationDomain.fanoutExamStartingSoon(examId);
}

export async function fanoutContestStartingSoon(contestId: string): Promise<void> {
  await notificationDomain.fanoutContestStartingSoon(contestId);
}
