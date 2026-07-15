import {
  assessmentRepo,
  contestRepo,
  courseMembershipRepo,
  durableWorkRepo,
  examRepo,
  notificationRepo,
  participationRepo,
  runTransaction,
  type NotificationCreateInput,
  type Prisma,
  type TransactionClient,
} from "@nojv/db";
import { pubsub } from "@nojv/redis";
import { SSE_NOTIFICATION, type NotificationSSEEvent } from "@nojv/core";

import { listStudentsBelowMaxScore } from "../assignment";
import {
  buildNotificationEmailWork,
  deliverNotificationEmail,
  notificationEmailWorkPayloadSchema,
  type NotificationEmailWorkPayload,
} from "./email";
import { getEffectiveNotificationPreferences } from "./preferences";

export {
  getNotificationPreferences,
  updateNotificationPreferences,
  getEffectiveNotificationPreferences,
} from "./preferences";

export const NOTIFICATION_SSE_WORK_KIND = "notification.sse";
export const NOTIFICATION_EMAIL_WORK_KIND = "notification.email";

type NotificationSseSnapshot = Omit<NotificationSSEEvent, "params"> & {
  params: NotificationCreateInput["params"];
};

export interface NotificationSseWorkPayload {
  notificationId: string;
  userId: string;
  event: NotificationSSEEvent;
}

function toSseEvent(row: {
  id: string;
  type: string;
  params: Prisma.JsonValue;
  linkUrl: string | null;
  createdAt: Date;
}): NotificationSseSnapshot {
  return {
    type: SSE_NOTIFICATION,
    id: row.id,
    notificationType: row.type,
    params: toInputJson(row.params),
    linkUrl: row.linkUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

interface NotificationDeliveryRow {
  id: string;
  userId: string;
  type: NotificationCreateInput["type"];
  params: Prisma.JsonValue;
  linkUrl: string | null;
  dedupeKey: string | null;
  createdAt: Date;
}

function toNotificationInput(row: NotificationDeliveryRow): NotificationCreateInput {
  return {
    userId: row.userId,
    type: row.type,
    params: toInputJson(row.params),
    linkUrl: row.linkUrl,
    dedupeKey: row.dedupeKey,
  };
}

function toInputJson(value: Prisma.JsonValue): NotificationCreateInput["params"] {
  if (value === null) throw new TypeError("Notification params must not be null.");
  return value;
}

async function enqueueNotificationDeliveries(
  tx: TransactionClient,
  rows: readonly NotificationDeliveryRow[],
): Promise<void> {
  if (rows.length === 0) return;

  await durableWorkRepo.withTx(tx).enqueueMany(
    rows.flatMap((row) => {
      const input = toNotificationInput(row);
      const emailWork = buildNotificationEmailWork(row.id, input);
      return [
        {
          kind: NOTIFICATION_SSE_WORK_KIND,
          dedupeKey: row.id,
          payload: {
            notificationId: row.id,
            userId: row.userId,
            event: toSseEvent(row),
          },
        },
        {
          kind: NOTIFICATION_EMAIL_WORK_KIND,
          dedupeKey: row.id,
          payload: emailWork,
        },
      ];
    }),
  );
}

export async function createNotificationInTransaction(
  tx: TransactionClient,
  input: NotificationCreateInput,
) {
  const { row, created } = await notificationRepo.withTx(tx).createAndCap(input);
  if (created) {
    await enqueueNotificationDeliveries(tx, [row]);
  }
  return row;
}

export function createNotification(input: NotificationCreateInput) {
  return runTransaction((tx) => createNotificationInTransaction(tx, input));
}

export async function createNotificationBatchInTransaction(
  tx: TransactionClient,
  inputs: readonly NotificationCreateInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const batchSize = 500;
  let total = 0;
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    const rows = await notificationRepo
      .withTx(tx)
      .createManyAndCap(inputs.slice(offset, offset + batchSize));
    await enqueueNotificationDeliveries(tx, rows);
    total += rows.length;
  }
  return total;
}

export function createNotificationBatch(inputs: NotificationCreateInput[]): Promise<number> {
  return runTransaction((tx) => createNotificationBatchInTransaction(tx, inputs));
}

export async function publishNotificationSse(
  work: NotificationSseWorkPayload,
): Promise<{ transport: "sse"; outcome: "published"; notificationId: string }> {
  await pubsub.publishNotification(work.userId, work.event);
  return { transport: "sse", outcome: "published", notificationId: work.notificationId };
}

export {
  deliverNotificationEmail,
  notificationEmailWorkPayloadSchema,
  type NotificationEmailWorkPayload,
};

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

export async function fanoutAssignmentStarted(
  assignmentId: string,
  opensAtIso: string,
): Promise<void> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return;
  if (assignment.status !== "published") return;
  if (assignment.opensAt.toISOString() !== opensAtIso) return;
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
      dedupeKey: `assignment_started:${assignment.id}:${opensAtIso}:${userId}`,
    })),
  );
}

export async function fanoutAssignmentDueSoon(
  assignmentId: string,
  closesAtIso: string,
  leadDays: number,
): Promise<void> {
  const assignment = await assessmentRepo.findByIdWithCourseId(assignmentId);
  if (!assignment) return;
  if (assignment.status !== "published") return;
  if (assignment.closesAt.toISOString() !== closesAtIso) return;
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
      dedupeKey: `assignment_due_soon:${assignment.id}:${dueAtIso}:${String(leadDays)}:${userId}`,
    })),
  );
}

export async function fanoutExamStartingSoon(
  examId: string,
  startsAtIso: string,
  leadDays: number,
): Promise<void> {
  const exam = await examRepo.findById(examId);
  if (!exam) return;
  if (exam.status !== "published") return;
  if (exam.startsAt.toISOString() !== startsAtIso) return;
  if (exam.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listExamParticipantUserIds(examId);
  if (participantIds.length === 0) return;

  const prefs = await getEffectiveNotificationPreferences(participantIds);
  const targeted = participantIds.filter(
    (userId) => prefs.get(userId)?.examStartingLeadDays === leadDays,
  );
  if (targeted.length === 0) return;

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
      dedupeKey: `exam_starting_soon:${exam.id}:${startsAtIso}:${String(leadDays)}:${userId}`,
    })),
  );
}

export async function fanoutContestStartingSoon(
  contestId: string,
  startsAtIso: string,
  leadDays: number,
): Promise<void> {
  const contest = await contestRepo.findById(contestId);
  if (!contest) return;
  if (contest.visibility !== "published") return;
  if (contest.startsAt.toISOString() !== startsAtIso) return;
  if (contest.startsAt.getTime() <= Date.now()) return;

  const participantIds = await participationRepo.listContestParticipantUserIds(contestId);
  if (participantIds.length === 0) return;

  const prefs = await getEffectiveNotificationPreferences(participantIds);
  const targeted = participantIds.filter(
    (userId) => prefs.get(userId)?.contestStartingLeadDays === leadDays,
  );
  if (targeted.length === 0) return;

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
      dedupeKey: `contest_starting_soon:${contest.id}:${startsAtIso}:${String(leadDays)}:${userId}`,
    })),
  );
}
