import { notificationDomain } from "@nojv/domain";
import { pubsub } from "@nojv/redis";

export const publishVerdict = pubsub.publishVerdict;
export const publishContestEvent = pubsub.publishContestEvent;
export const publishAssessmentDeadline = pubsub.publishAssessmentDeadline;

export async function fanoutAssignmentDueSoon(assessmentId: string): Promise<void> {
  await notificationDomain.fanoutAssignmentDueSoon(assessmentId);
}

export async function fanoutExamStartingSoon(examId: string): Promise<void> {
  await notificationDomain.fanoutExamStartingSoon(examId);
}

export async function fanoutContestStartingSoon(contestId: string): Promise<void> {
  await notificationDomain.fanoutContestStartingSoon(contestId);
}
