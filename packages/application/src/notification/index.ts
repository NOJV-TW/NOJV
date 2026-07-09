import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  examRepo,
  notificationRepo,
  participationRepo,
  type NotificationCreateInput,
} from "@nojv/db";
import { pubsub } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

import { listStudentsBelowMaxScore } from "../assignment";
import { hasEmailSpec, maybeSendEmails } from "./email";
import { getEffectiveNotificationPreferences } from "./preferences";

export {
  getNotificationPreferences,
  updateNotificationPreferences,
  getEffectiveNotificationPreferences,
} from "./preferences";

const NO_SKIPPED_DEDUPE_KEYS: ReadonlySet<string> = new Set<string>();

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
  const skipped =
    hasEmailSpec(input.type) &&
    input.dedupeKey != null &&
    (await notificationRepo.listExistingDedupeKeys([input.dedupeKey])).length > 0
      ? new Set([input.dedupeKey])
      : NO_SKIPPED_DEDUPE_KEYS;

  const row = await notificationRepo.createAndCap(input);
  await pubsub.publishNotification(input.userId, toSseEvent(row));

  void maybeSendEmails([input], skipped).catch((err: unknown) =>
    console.warn("[notification-email] dispatch failed:", err),
  );

  return row;
}

export async function createNotificationBatch(inputs: NotificationCreateInput[]) {
  if (inputs.length === 0) return 0;

  const dedupeKeys = inputs.some((i) => hasEmailSpec(i.type))
    ? inputs.map((i) => i.dedupeKey).filter((k): k is string => k != null)
    : [];
  const skipped: ReadonlySet<string> =
    dedupeKeys.length > 0
      ? new Set(await notificationRepo.listExistingDedupeKeys(dedupeKeys))
      : NO_SKIPPED_DEDUPE_KEYS;

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

  void maybeSendEmails(inputs, skipped).catch((err: unknown) =>
    console.warn("[notification-email] dispatch failed:", err),
  );

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

export async function fanoutAssignmentStarted(assignmentId: string): Promise<void> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return;
  if (assignment.status !== "published") return;
  if (assignment.opensAt.getTime() > Date.now()) return;
  if (assignment.closesAt.getTime() <= Date.now()) return;

  const studentIds = await courseMembershipRepo.listActiveStudentUserIds(assignment.courseId);
  if (studentIds.length === 0) return;

  await createNotificationBatch(
    studentIds.map((userId) => ({
      userId,
      type: "assignment_started",
      params: {
        courseId: assignment.courseId,
        assignmentId: assignment.id,
        title: assignment.title,
      },
      linkUrl: `/assignments/${assignment.id}`,
      dedupeKey: `assignment_started:${assignment.id}:${userId}`,
    })),
  );
}

export async function fanoutAssignmentDueSoon(
  assignmentId: string,
  leadDays: number,
): Promise<void> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return;
  if (assignment.status !== "published") return;
  if (assignment.closesAt.getTime() <= Date.now()) return;

  const studentIds = await courseMembershipRepo.listActiveStudentUserIds(assignment.courseId);
  if (studentIds.length === 0) return;

  const notYetMaxed = await listStudentsBelowMaxScore(assignmentId, studentIds);
  if (notYetMaxed.length === 0) return;

  const prefs = await getEffectiveNotificationPreferences(notYetMaxed);
  const targeted = notYetMaxed.filter(
    (userId) => prefs.get(userId)?.assignmentDueSoonLeadDays === leadDays,
  );
  if (targeted.length === 0) return;

  const dueAtIso = assignment.closesAt.toISOString();
  await createNotificationBatch(
    targeted.map((userId) => ({
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

export async function fanoutExamStartingSoon(examId: string, leadDays: number): Promise<void> {
  const exam = await examRepo.findById(examId);
  if (!exam) return;
  if (exam.status !== "published") return;
  if (exam.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listExamParticipantUserIds(examId);
  if (participantIds.length === 0) return;

  const prefs = await getEffectiveNotificationPreferences(participantIds);
  const targeted = participantIds.filter(
    (userId) => prefs.get(userId)?.examStartingLeadDays === leadDays,
  );
  if (targeted.length === 0) return;

  const startsAtIso = exam.startsAt.toISOString();
  await createNotificationBatch(
    targeted.map((userId) => ({
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

export async function fanoutContestStartingSoon(
  contestId: string,
  leadDays: number,
): Promise<void> {
  const contest = await contestRepo.findById(contestId);
  if (!contest) return;
  if (contest.visibility !== "published") return;
  if (contest.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listContestParticipantUserIds(contestId);
  if (participantIds.length === 0) return;

  const prefs = await getEffectiveNotificationPreferences(participantIds);
  const targeted = participantIds.filter(
    (userId) => prefs.get(userId)?.contestStartingLeadDays === leadDays,
  );
  if (targeted.length === 0) return;

  const startsAtIso = contest.startsAt.toISOString();
  await createNotificationBatch(
    targeted.map((userId) => ({
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
