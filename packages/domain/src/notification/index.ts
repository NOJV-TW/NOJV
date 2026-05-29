import {
  assessmentRepo,
  contestParticipationRepo,
  contestRepo,
  courseMembershipRepo,
  examParticipationRepo,
  examRepo,
  notificationRepo,
  type NotificationCreateInput,
} from "@nojv/db";
import { pubsub } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

import { listStudentsBelowMaxScore } from "../assignment";

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
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createNotification(input: NotificationCreateInput) {
  const row = await notificationRepo.createAndCap(input);
  await pubsub.publishNotification(input.userId, toSseEvent(row));
  return row;
}

export async function createNotificationBatch(inputs: NotificationCreateInput[]) {
  if (inputs.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < inputs.length; i += BATCH) {
    total += await notificationRepo.createManyAndCap(inputs.slice(i, i + BATCH));
  }

  // One signal per unique userId — clients refetch /api/notifications/recent
  // regardless of how many rows landed, so per-row publishes would be waste.
  // Pick the first row's detail as a sample payload for debugging in Redis logs.
  const firstPerUser = new Map<string, NotificationCreateInput>();
  for (const input of inputs) {
    if (!firstPerUser.has(input.userId)) firstPerUser.set(input.userId, input);
  }
  for (const [userId, sample] of firstPerUser) {
    await pubsub.publishNotificationBatchSignal(userId, {
      notificationType: sample.type,
      params: sample.params,
      linkUrl: sample.linkUrl ?? null,
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

/** Delete a single notification owned by the caller. */
export async function deleteOne(userId: string, notificationId: string) {
  return notificationRepo.deleteOne(userId, notificationId);
}

/**
 * Drop every notification belonging to the caller. With `{ onlyRead: true }`
 * we keep unread rows so the inbox-clear UX doesn't silently swallow alerts
 * the user hasn't seen yet.
 */
export async function deleteAll(userId: string, opts?: { onlyRead?: boolean }) {
  return notificationRepo.deleteAll(userId, opts);
}

/**
 * Fan out `assignment_due_soon` notifications to every active student in
 * the course who has not yet reached the assignment's maximum score.
 *
 * No-ops (returns silently) when the assignment was unpublished, deleted,
 * or already closed between workflow schedule time and the fire moment.
 */
export async function fanoutAssignmentDueSoon(assignmentId: string): Promise<void> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return;
  if (assignment.status !== "published") return;
  if (assignment.closesAt.getTime() <= Date.now()) return;

  const studentIds = await courseMembershipRepo.listActiveStudentUserIds(assignment.courseId);
  if (studentIds.length === 0) return;

  const notYetMaxed = await listStudentsBelowMaxScore(assignmentId, studentIds);
  if (notYetMaxed.length === 0) return;

  const dueAtIso = assignment.closesAt.toISOString();
  await createNotificationBatch(
    notYetMaxed.map((userId) => ({
      userId,
      type: "assignment_due_soon",
      params: {
        courseId: assignment.courseId,
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: dueAtIso,
      },
      linkUrl: `/assignments/${assignment.id}`,
      dedupeKey: `assignment_due_soon:${assignment.id}:${userId}`,
    })),
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
        startsAt: startsAtIso,
      },
      linkUrl: `/exams/${exam.id}`,
      dedupeKey: `exam_starting_soon:${exam.id}:${userId}`,
    })),
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
        startsAt: startsAtIso,
      },
      linkUrl: `/contests/${contest.id}`,
      dedupeKey: `contest_starting_soon:${contest.id}:${userId}`,
    })),
  );
}
