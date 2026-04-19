import {
  assessmentRepo,
  contestParticipationRepo,
  contestRepo,
  courseMembershipRepo,
  examParticipationRepo,
  examRepo,
  notificationRepo,
  type NotificationCreateInput
} from "@nojv/db";
import { pubsub } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

import { listStudentsBelowMaxScore } from "../assessment";

export type CreateNotificationInput = NotificationCreateInput;

function toSseEvent(row: {
  id: string;
  type: string;
  params: unknown;
  linkUrl: string | null;
  createdAt: Date;
}): NotificationSSEEvent {
  return {
    type: SSE_NOTIFICATION,
    id: row.id,
    notificationType: row.type,
    params: row.params,
    linkUrl: row.linkUrl,
    createdAt: row.createdAt.toISOString()
  };
}

export async function createNotification(input: CreateNotificationInput) {
  const row = await notificationRepo.createAndCap(input);
  await pubsub.publishNotification(input.userId, toSseEvent(row));
  return row;
}

export async function createNotificationBatch(inputs: CreateNotificationInput[]) {
  if (inputs.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < inputs.length; i += BATCH) {
    total += await notificationRepo.createManyAndCap(inputs.slice(i, i + BATCH));
  }

  // One signal per unique userId — clients refetch /api/notifications/recent
  // regardless of how many rows landed, so per-row publishes would be waste.
  // Pick the first row's detail as a sample payload for debugging in Redis logs.
  const firstPerUser = new Map<string, CreateNotificationInput>();
  for (const input of inputs) {
    if (!firstPerUser.has(input.userId)) firstPerUser.set(input.userId, input);
  }
  for (const [userId, sample] of firstPerUser) {
    await pubsub.publishNotificationBatchSignal(userId, {
      notificationType: sample.type,
      params: sample.params,
      linkUrl: sample.linkUrl ?? null
    });
  }

  return total;
}

export async function listRecent(userId: string, limit: number) {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return notificationRepo.listRecent(userId, safeLimit);
}

export async function countUnread(userId: string) {
  return notificationRepo.countUnread(userId);
}

export async function markAsRead(userId: string, notificationId: string) {
  return notificationRepo.markRead(userId, notificationId);
}

export async function markAllAsRead(userId: string) {
  return notificationRepo.markAllRead(userId);
}

/**
 * Fan out `assignment_due_soon` notifications to every active student in
 * the course who has not yet reached the assessment's maximum score.
 *
 * No-ops (returns silently) when the assessment was unpublished, deleted,
 * or already closed between workflow schedule time and the fire moment.
 */
export async function fanoutAssignmentDueSoon(assessmentId: string): Promise<void> {
  const assessment = await assessmentRepo.findByIdWithCourseId(assessmentId);
  if (!assessment) return;
  if (assessment.status !== "published") return;
  if (assessment.closesAt.getTime() <= Date.now()) return;

  const members = await courseMembershipRepo.findStudents(assessment.courseId);
  const studentIds = members.map((m) => m.userId);
  if (studentIds.length === 0) return;

  const notYetMaxed = await listStudentsBelowMaxScore(assessmentId, studentIds);
  if (notYetMaxed.length === 0) return;

  const dueAtIso = assessment.closesAt.toISOString();
  await createNotificationBatch(
    notYetMaxed.map((userId) => ({
      userId,
      type: "assignment_due_soon",
      params: {
        courseId: assessment.courseId,
        assessmentId: assessment.id,
        title: assessment.title,
        dueAt: dueAtIso
      },
      linkUrl: `/assignments/${assessment.id}`
    }))
  );
}

/**
 * Fan out `exam_starting_soon` notifications to every registered
 * participant of a published exam.
 *
 * No-ops (returns silently) when the exam is unpublished/deleted, has no
 * `startsAt`, or `startsAt` has already passed — the workflow schedules
 * this ~15 min before `startsAt`, but retries and clock skew can fire it
 * late, at which point the reminder is stale.
 */
export async function fanoutExamStartingSoon(examId: string): Promise<void> {
  const exam = await examRepo.findById(examId);
  if (!exam) return;
  if (exam.status !== "published") return;
  if (exam.startsAt.getTime() <= Date.now()) return;

  const participantIds = await examParticipationRepo.listParticipantUserIds(examId);
  if (participantIds.length === 0) return;

  const startsAtIso = exam.startsAt.toISOString();
  await createNotificationBatch(
    participantIds.map((userId) => ({
      userId,
      type: "exam_starting_soon",
      params: {
        courseId: exam.courseId,
        examId: exam.id,
        title: exam.title,
        startsAt: startsAtIso
      },
      linkUrl: `/exams/${exam.id}`
    }))
  );
}

/**
 * Fan out `contest_starting_soon` notifications to every registered
 * participant of a published contest. Contests use the
 * `visibility` enum (no `status` field) — gate on
 * `visibility === "published"`.
 */
export async function fanoutContestStartingSoon(contestId: string): Promise<void> {
  const contest = await contestRepo.findById(contestId);
  if (!contest) return;
  if (contest.visibility !== "published") return;
  if (contest.startsAt.getTime() <= Date.now()) return;

  const participantIds = await contestParticipationRepo.listParticipantUserIds(contestId);
  if (participantIds.length === 0) return;

  const startsAtIso = contest.startsAt.toISOString();
  await createNotificationBatch(
    participantIds.map((userId) => ({
      userId,
      type: "contest_starting_soon",
      params: {
        contestId: contest.id,
        title: contest.title,
        startsAt: startsAtIso
      },
      linkUrl: `/contests/${contest.id}`
    }))
  );
}
