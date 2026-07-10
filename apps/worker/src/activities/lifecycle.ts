import {
  contestDomain,
  examDomain,
  notificationDomain,
  reconcileLifecycleTimers,
  submissionDomain,
} from "@nojv/application";
import { pubsub } from "@nojv/redis";

import { createLogger } from "../logger.js";

const logger = createLogger("sweeper");

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

export async function updateContestScores(
  contestId: string,
  userId: string,
): Promise<string | null> {
  return contestDomain.updateContestScores(contestId, userId);
}

export async function updateExamScores(examId: string, userId: string): Promise<void> {
  await examDomain.updateExamScores(examId, userId);
}

export async function closeActiveSessionsForExam(examId: string): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(examId);
}

export async function sweepStaleSubmissions(): Promise<submissionDomain.SweepStaleSubmissionsResult> {
  const result = await submissionDomain.sweepStaleSubmissions();
  if (result.scanned > 0) {
    logger.info("stale submission sweep", { ...result });
  }
  return result;
}

export async function reconcileLifecycleWorkflows(): Promise<void> {
  const result = await reconcileLifecycleTimers();
  if (result.exams > 0 || result.contests > 0 || result.assignments > 0) {
    logger.info("lifecycle timer reconcile", { ...result });
  }
}

export const publishVerdict = pubsub.publishVerdict;
export const publishContestEvent = pubsub.publishContestEvent;
export const publishScoreboardUpdate = pubsub.publishScoreboardUpdate;

export async function fanoutAssignmentStarted(assignmentId: string): Promise<void> {
  await notificationDomain.fanoutAssignmentStarted(assignmentId);
}

export async function fanoutAssignmentDueSoon(
  assignmentId: string,
  leadDays: number,
): Promise<void> {
  await notificationDomain.fanoutAssignmentDueSoon(assignmentId, leadDays);
}

export async function fanoutExamStartingSoon(examId: string, leadDays: number): Promise<void> {
  await notificationDomain.fanoutExamStartingSoon(examId, leadDays);
}

export async function fanoutContestStartingSoon(
  contestId: string,
  leadDays: number,
): Promise<void> {
  await notificationDomain.fanoutContestStartingSoon(contestId, leadDays);
}
