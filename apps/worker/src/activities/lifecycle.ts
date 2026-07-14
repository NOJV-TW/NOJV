import {
  contestDomain,
  examDomain,
  notificationDomain,
  reconcileLifecycleTimers,
  submissionDomain,
  isAssignmentLifecycleCurrent,
  isContestLifecycleCurrent,
  isExamLifecycleCurrent,
} from "@nojv/application";
import type {
  AssignmentDueSoonInput,
  ContestLifecycleInput,
  ExamAutoCloseInput,
} from "@nojv/core";
import { pubsub } from "@nojv/redis";

import { createLogger } from "../logger.js";

const logger = createLogger("sweeper");

export async function activateContest(input: ContestLifecycleInput): Promise<boolean> {
  return contestDomain.activateContest(input);
}

export async function freezeScoreboard(input: ContestLifecycleInput): Promise<boolean> {
  return contestDomain.freezeContestBoard(input);
}

export async function finalizeContest(input: ContestLifecycleInput): Promise<boolean> {
  return contestDomain.finalizeContest(input);
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

export async function closeActiveSessionsForExam(
  input: ExamAutoCloseInput,
): Promise<{ closed: number }> {
  return examDomain.session.autoCloseForExam(input);
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

export async function fanoutAssignmentStarted(input: AssignmentDueSoonInput): Promise<void> {
  if (!(await isAssignmentLifecycleCurrent(input))) return;
  await notificationDomain.fanoutAssignmentStarted(input.assignmentId, input.opensAt);
}

export async function fanoutAssignmentDueSoon(
  input: AssignmentDueSoonInput,
  leadDays: number,
): Promise<void> {
  if (!(await isAssignmentLifecycleCurrent(input))) return;
  await notificationDomain.fanoutAssignmentDueSoon(
    input.assignmentId,
    input.closesAt,
    leadDays,
  );
}

export async function fanoutExamStartingSoon(
  input: ExamAutoCloseInput,
  leadDays: number,
): Promise<void> {
  if (!(await isExamLifecycleCurrent(input))) return;
  await notificationDomain.fanoutExamStartingSoon(input.examId, input.startsAt, leadDays);
}

export async function fanoutContestStartingSoon(
  input: ContestLifecycleInput,
  leadDays: number,
): Promise<void> {
  if (!(await isContestLifecycleCurrent(input))) return;
  await notificationDomain.fanoutContestStartingSoon(input.contestId, input.startsAt, leadDays);
}
