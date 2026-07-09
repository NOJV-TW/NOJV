import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  notificationRepo,
  notificationPreferenceRepo,
  participationRepo,
  type NotificationCreateInput,
} from "@nojv/db";
import { pubsub } from "@nojv/redis";
import {
  SSE_NOTIFICATION,
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
  type NotificationPreferences,
  type NotificationSSEEvent,
} from "@nojv/core";

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

export async function deleteOne(userId: string, notificationId: string) {
  return notificationRepo.deleteOne(userId, notificationId);
}

export async function deleteAll(userId: string, opts?: { onlyRead?: boolean }) {
  return notificationRepo.deleteAll(userId, opts);
}

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

export async function fanoutExamStartingSoon(examId: string): Promise<void> {
  const exam = await examRepo.findById(examId);
  if (!exam) return;
  if (exam.status !== "published") return;
  if (exam.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listExamParticipantUserIds(examId);
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

export async function getNotificationPreferences(userId: string) {
  return notificationPreferencesSchema.parse(
    (await notificationPreferenceRepo.get(userId)) ?? {},
  );
}

export async function updateNotificationPreferences(userId: string, input: unknown) {
  const prefs = notificationPreferencesSchema.parse(input);
  const row = await notificationPreferenceRepo.upsert(userId, prefs);
  return notificationPreferencesSchema.parse(row);
}

export async function getEffectiveNotificationPreferences(
  userIds: string[],
): Promise<Map<string, NotificationPreferences>> {
  const uniqueIds = Array.from(new Set(userIds));
  const result = new Map<string, NotificationPreferences>();
  if (uniqueIds.length === 0) return result;

  const rows = await notificationPreferenceRepo.findManyByUserIds(uniqueIds);
  const byUserId = new Map(rows.map((row) => [row.userId, row]));

  for (const userId of uniqueIds) {
    const row = byUserId.get(userId);
    result.set(
      userId,
      row ? notificationPreferencesSchema.parse(row) : DEFAULT_NOTIFICATION_PREFERENCES,
    );
  }

  return result;
}

export async function fanoutContestStartingSoon(contestId: string): Promise<void> {
  const contest = await contestRepo.findById(contestId);
  if (!contest) return;
  if (contest.visibility !== "published") return;
  if (contest.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listContestParticipantUserIds(contestId);
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
