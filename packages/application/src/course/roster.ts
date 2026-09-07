import { durableWorkRepo, type TransactionClient } from "@nojv/db";

import * as notificationDomain from "../notification";

export async function lockRosterIdentity(tx: TransactionClient): Promise<void> {
  // ponytail: serialize identity changes; use ordered username locks if enrollment throughput requires it.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('course-roster:identity', 0))`;
}

export async function lockCourseMembers(
  tx: TransactionClient,
  courseId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
}

async function mergeGrades(
  tx: TransactionClient,
  sourceId: string,
  targetId: string,
  userId: string,
): Promise<void> {
  await tx.scoreOverrideAuditLog.updateMany({
    where: { courseMembershipId: sourceId, sourceMembershipId: null },
    data: { sourceMembershipId: sourceId },
  });
  await tx.scoreOverrideAuditLog.updateMany({
    where: { courseMembershipId: sourceId },
    data: { courseMembershipId: targetId },
  });
  await tx.submissionFeedbackAuditLog.updateMany({
    where: { courseMembershipId: sourceId, sourceMembershipId: null },
    data: { sourceMembershipId: sourceId },
  });
  await tx.submissionFeedbackAuditLog.updateMany({
    where: { courseMembershipId: sourceId },
    data: { courseMembershipId: targetId },
  });

  const scores = await tx.scoreOverride.findMany({
    where: { courseMembershipId: sourceId },
  });
  for (const source of scores) {
    const target = await tx.scoreOverride.findUnique({
      where: {
        courseMembershipId_problemId_contextType_contextId: {
          courseMembershipId: targetId,
          problemId: source.problemId,
          contextType: source.contextType,
          contextId: source.contextId,
        },
      },
    });
    if (!target) {
      await tx.scoreOverride.update({
        where: { id: source.id },
        data: { courseMembershipId: targetId, updatedAt: source.updatedAt },
      });
      continue;
    }
    await tx.scoreOverrideAuditLog.create({
      data: {
        overrideId: target.id,
        courseMembershipId: targetId,
        sourceMembershipId: sourceId,
        userId,
        problemId: source.problemId,
        contextType: source.contextType,
        contextId: source.contextId,
        action: "merge",
        oldScore: source.overrideScore,
        newScore: target.overrideScore,
        oldReason: source.reason,
        newReason: target.reason,
        changedByUserId: userId,
      },
    });
    await tx.scoreOverrideAuditLog.updateMany({
      where: { overrideId: source.id },
      data: { overrideId: target.id },
    });
    await tx.scoreOverride.delete({ where: { id: source.id } });
  }

  const feedback = await tx.submissionFeedback.findMany({
    where: { courseMembershipId: sourceId },
  });
  for (const source of feedback) {
    const target = await tx.submissionFeedback.findFirst({
      where: {
        courseMembershipId: targetId,
        problemId: source.problemId,
        assessmentId: source.assessmentId,
        examId: source.examId,
      },
    });
    if (!target) {
      await tx.submissionFeedback.update({
        where: { id: source.id },
        data: { courseMembershipId: targetId, updatedAt: source.updatedAt },
      });
      continue;
    }
    await tx.submissionFeedbackAuditLog.create({
      data: {
        feedbackId: target.id,
        courseMembershipId: targetId,
        sourceMembershipId: sourceId,
        studentUserId: userId,
        problemId: source.problemId,
        assessmentId: source.assessmentId,
        examId: source.examId,
        action: "merge",
        oldComment: source.comment,
        newComment: target.comment,
        changedByUserId: userId,
      },
    });
    await tx.submissionFeedbackAuditLog.updateMany({
      where: { feedbackId: source.id },
      data: { feedbackId: target.id },
    });
    await tx.submissionFeedback.delete({ where: { id: source.id } });
  }
}

export async function bindPendingMemberships(
  tx: TransactionClient,
  userId: string,
  username: string,
  schoolVerified: boolean,
  courseId?: string,
): Promise<number> {
  const where = { pendingUsername: username, ...(courseId ? { courseId } : {}) };
  const courses = await tx.courseMembership.findMany({
    where,
    select: { courseId: true },
    orderBy: { courseId: "asc" },
  });
  for (const row of courses) await lockCourseMembers(tx, row.courseId);
  const pending = await tx.courseMembership.findMany({
    where,
    include: { course: { select: { ownerId: true, title: true } } },
    orderBy: { courseId: "asc" },
  });

  for (const row of pending) {
    const existing = await tx.courseMembership.findUnique({
      where: { courseId_userId: { courseId: row.courseId, userId } },
    });
    let targetId = row.id;
    if (existing) {
      const keepPending = schoolVerified;
      const target = keepPending ? row : existing;
      const source = keepPending ? existing : row;
      targetId = target.id;
      await mergeGrades(tx, source.id, target.id, userId);
      const protectedMember = existing.role === "teacher" || row.course.ownerId === userId;
      if (keepPending && protectedMember) {
        await tx.courseMembership.update({
          where: { id: target.id },
          data: {
            role: existing.role,
            status: existing.status,
            removedAt: existing.removedAt,
          },
        });
      } else if (
        !protectedMember &&
        source.status === "removed" &&
        target.status !== "removed"
      ) {
        await tx.courseMembership.update({
          where: { id: target.id },
          data: { status: "removed", removedAt: source.removedAt },
        });
      }
      await tx.courseMembership.delete({ where: { id: source.id } });
    }
    await tx.courseMembership.update({
      where: { id: targetId },
      data: { userId, pendingUsername: null },
    });

    if (!existing && row.role === "student" && row.status === "active") {
      await notificationDomain.createNotificationInTransaction(tx, {
        userId,
        type: "course_enrolled",
        params: { courseId: row.courseId, courseName: row.course.title },
        linkUrl: `/courses/${row.courseId}`,
        dedupeKey: `course_enrolled:${row.id}:${row.joinedAt.toISOString()}`,
      });
    }

    const participations = await tx.participation.findMany({
      where: { userId, exam: { courseId: row.courseId } },
      select: { examId: true },
    });
    for (const participation of participations) {
      if (!participation.examId) continue;
      await durableWorkRepo.withTx(tx).enqueue({
        kind: "score.converge",
        dedupeKey: `roster:${row.id}:${userId}:${participation.examId}`,
        payload: { context: { type: "exam", examId: participation.examId }, userId },
      });
    }
  }
  return pending.length;
}
