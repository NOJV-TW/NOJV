import {
  assignmentDomain,
  contestDomain,
  examDomain,
  notificationDomain,
  userDomain,
} from "@nojv/domain";
import { pubsub } from "@nojv/redis";

// --- Contest ------------------------------------------------------------

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

// --- Assignment ---------------------------------------------------------
// Activity names (getAssessmentInfo, activateAssessment, closeAssessment) are
// preserved as the temporal-worker wire identifier — renaming them would break
// in-flight workflows. Internally they delegate to the renamed domain helpers.

export type AssessmentInfo = Awaited<ReturnType<typeof assignmentDomain.getAssignmentInfo>>;

export async function getAssessmentInfo(assessmentId: string) {
  return assignmentDomain.getAssignmentInfo(assessmentId);
}

export async function activateAssessment(assessmentId: string): Promise<void> {
  await assignmentDomain.markAssignmentPublished(assessmentId);
}

export async function closeAssessment(assessmentId: string): Promise<void> {
  await assignmentDomain.markAssignmentArchived(assessmentId);
}

// --- Exam session -------------------------------------------------------

export async function closeActiveSessionsForExam(examId: string): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(examId);
}

// --- Notification -------------------------------------------------------

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

// --- User stats ---------------------------------------------------------

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
