import { notificationDomain } from "@nojv/domain";
import { pubsub } from "@nojv/redis";

export const publishVerdict = pubsub.publishVerdict;
export const publishContestEvent = pubsub.publishContestEvent;
export const publishAssessmentDeadline = pubsub.publishAssessmentDeadline;

export async function fanoutAssignmentDueSoon(assessmentId: string): Promise<void> {
  await notificationDomain.fanoutAssignmentDueSoon(assessmentId);
}
