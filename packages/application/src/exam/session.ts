import {
  courseMembershipRepo,
  courseRepo,
  examRepo,
  examSessionRepo,
  participationRepo,
  runTransaction,
  type Prisma,
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from "../shared/errors";
import { isCourseStaffTx } from "../shared/permissions";

export type ExamSessionReleaseReason = "submitted" | "time_up" | "released_by_instructor";

export type ExamSessionEventType =
  "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat";

export interface ActiveSessionContext {
  session: {
    id: string;
    examId: string;
    userId: string;
    startedAt: Date;
  };
  exam: {
    id: string;
    courseId: string;
    title: string;
  };
  course: {
    id: string;
  };
}

async function assertEnrolledInExamCourse(
  tx: Prisma.TransactionClient,
  userId: string,
  examId: string,
) {
  const exam = await examRepo.withTx(tx).findById(examId);
  if (!exam) {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }

  const [membership, course] = await Promise.all([
    courseMembershipRepo.withTx(tx).findByComposite(exam.courseId, userId),
    courseRepo.withTx(tx).findArchivedById(exam.courseId),
  ]);

  if (membership?.status !== "active") {
    throw new ForbiddenError("You must be enrolled in the course to access this exam.");
  }

  if (course?.archived) {
    throw new ForbiddenError("This course is archived; new exam sessions are not allowed.");
  }

  return exam;
}

export async function startSession(actor: ActorContext, { examId }: { examId: string }) {
  return runTransaction(async (tx) => {
    const lockKey = `exam-session:${actor.userId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    await assertEnrolledInExamCourse(tx, actor.userId, examId);

    const activeElsewhere = await examSessionRepo.withTx(tx).findActiveForUser(actor.userId);
    if (activeElsewhere && activeElsewhere.examId !== examId) {
      throw new ConflictError("You already have an active session on a different exam.");
    }

    const existingParticipation = await participationRepo
      .withTx(tx)
      .findExamParticipation(examId, actor.userId);
    const activateOnEntry =
      !existingParticipation || existingParticipation.status === "registered";
    await participationRepo
      .withTx(tx)
      .upsertExamActive(examId, actor.userId, activateOnEntry, new Date());

    const existing = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);

    if (existing?.endedAt === null) {
      return existing;
    }

    const now = new Date();
    const session = existing
      ? await examSessionRepo.withTx(tx).update(existing.id, {
          startedAt: now,
          endedAt: null,
          releaseReason: null,
          lastHeartbeatAt: now,
        })
      : await examSessionRepo.withTx(tx).create({
          userId: actor.userId,
          examId,
          startedAt: now,
          lastHeartbeatAt: now,
        });

    await examSessionRepo.withTx(tx).recordEvent({ sessionId: session.id, eventType: "enter" });

    return session;
  });
}

export async function endSession(
  actor: ActorContext,
  { examId, reason }: { examId: string; reason: ExamSessionReleaseReason },
) {
  return runTransaction(async (tx) => {
    await assertEnrolledInExamCourse(tx, actor.userId, examId);

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);

    if (!session) {
      throw new NotFoundError("No active exam session to end.");
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      endedAt: new Date(),
      releaseReason: reason,
    });

    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "release",
      metadata: { reason },
    });

    return updated;
  });
}

export async function recordEvent(
  actor: ActorContext,
  {
    examId,
    eventType,
    metadata,
  }: {
    examId: string;
    eventType: ExamSessionEventType;
    metadata?: Prisma.InputJsonValue | null;
  },
) {
  return runTransaction(async (tx) => {
    await assertEnrolledInExamCourse(tx, actor.userId, examId);

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);

    if (!session) {
      throw new NotFoundError("No active exam session for this exam.");
    }

    return examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType,
      ...(metadata === undefined || metadata === null ? {} : { metadata }),
    });
  });
}

export async function autoCloseForExam(examId: string): Promise<{ closed: number }> {
  return runTransaction(async (tx) => {
    const active = await examSessionRepo.withTx(tx).findAllActiveForExam(examId);
    if (active.length === 0) return { closed: 0 };

    const now = new Date();
    const ids = active.map((session) => session.id);
    await examSessionRepo.withTx(tx).updateManyById(ids, {
      endedAt: now,
      releaseReason: "time_up",
    });
    await examSessionRepo
      .withTx(tx)
      .recordEvents(ids.map((sessionId) => ({ sessionId, eventType: "auto_close" })));
    return { closed: active.length };
  });
}

export async function getActiveSessionContext(
  userId: string,
): Promise<ActiveSessionContext | null> {
  const session = await examSessionRepo.findActiveForUser(userId);
  if (!session) return null;

  const exam = await examRepo.findByIdOrThrow(session.examId, {
    id: true,
    courseId: true,
    title: true,
  });

  return {
    session: {
      id: session.id,
      examId: session.examId,
      userId: session.userId,
      startedAt: session.startedAt,
    },
    exam: {
      id: exam.id,
      courseId: exam.courseId,
      title: exam.title,
    },
    course: {
      id: exam.courseId,
    },
  };
}

export async function requireActiveSessionForUserExam(userId: string, examId: string) {
  const session = await examSessionRepo.findActiveForUser(userId);
  if (session?.examId !== examId || session.endedAt !== null) {
    throw new ForbiddenError("No active exam session for this exam.");
  }
  return session;
}

export const START_GRACE_MS = 5 * 60 * 1000;

export interface StartSessionResult {
  session: {
    id: string;
    examId: string;
    userId: string;
    startedAt: Date;
    endedAt: Date | null;
  };
  exam: {
    id: string;
    endsAt: Date;
  };
  created: boolean;
}

export async function startSessionWithGate(
  actor: ActorContext,
  options: {
    examId: string;
    now?: Date;
    gracePeriodMs?: number;
  },
): Promise<StartSessionResult> {
  const now = options.now ?? new Date();
  const grace = options.gracePeriodMs ?? START_GRACE_MS;

  const exam = await examRepo.findById(options.examId);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${options.examId}`);
  }

  if (now.getTime() < exam.startsAt.getTime() - grace) {
    throw new HttpError("Exam has not started yet.", 410);
  }
  if (now.getTime() >= exam.endsAt.getTime()) {
    throw new HttpError("Exam has ended.", 410);
  }

  const existingActive = await examSessionRepo.findActiveForUser(actor.userId);
  if (existingActive && existingActive.examId !== options.examId) {
    throw new ConflictError("You already have an active session on a different exam.");
  }

  const sameExamIdempotent = existingActive?.examId === options.examId;
  const session = await startSession(actor, { examId: options.examId });

  return {
    session: {
      id: session.id,
      examId: session.examId,
      userId: session.userId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    },
    exam: { id: exam.id, endsAt: exam.endsAt },
    created: !sameExamIdempotent,
  };
}

export async function releaseSessionAsInstructor(
  actor: ActorContext,
  { examId, targetUserId }: { examId: string; targetUserId: string },
) {
  return runTransaction(async (tx) => {
    const exam = await examRepo.withTx(tx).findById(examId);
    if (!exam) {
      throw new NotFoundError(`Exam not found: ${examId}`);
    }

    const isStaff = await isCourseStaffTx(tx, actor.userId, exam.courseId);
    if (!isStaff) {
      throw new ForbiddenError("Only course staff can release exam sessions.");
    }

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(targetUserId, examId);
    if (session?.endedAt !== null) {
      throw new NotFoundError("No active exam session to release.");
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      endedAt: new Date(),
      releaseReason: "released_by_instructor",
    });

    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "release",
      metadata: {
        reason: "released_by_instructor",
        endedByUserId: actor.userId,
      },
    });

    return updated;
  });
}

const IP_BINDING_RESET_GRACE_MINUTES = 10;

export async function resetStudentIpBinding(
  actor: ActorContext,
  { examId, targetUserId }: { examId: string; targetUserId: string },
  now: Date = new Date(),
): Promise<{ exemptUntil: Date }> {
  return runTransaction(async (tx) => {
    const exam = await examRepo.withTx(tx).findById(examId);
    if (!exam) {
      throw new NotFoundError(`Exam not found: ${examId}`);
    }

    const isStaff = await isCourseStaffTx(tx, actor.userId, exam.courseId);
    if (!isStaff) {
      throw new ForbiddenError("Only course staff can reset a student's IP binding.");
    }

    const exemptUntil = new Date(now.getTime() + IP_BINDING_RESET_GRACE_MINUTES * 60_000);
    await participationRepo.withTx(tx).clearExamPinAndExempt(examId, targetUserId, exemptUntil);
    return { exemptUntil };
  });
}

export interface ActiveSessionRow {
  userId: string;
  displayName: string;
  handle: string;
  startedAt: string;
}

export async function listActiveSessions(examId: string): Promise<ActiveSessionRow[]> {
  const rows = await examSessionRepo.findAllActiveForExamWithUser(examId);
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.user.name,
    handle: r.user.displayUsername ?? r.user.email,
    startedAt: r.startedAt.toISOString(),
  }));
}

export async function releaseAllSessionsAsInstructor(
  actor: ActorContext,
  { examId }: { examId: string },
): Promise<{ released: number; releasedUserIds: string[] }> {
  return runTransaction(async (tx) => {
    const exam = await examRepo.withTx(tx).findById(examId);
    if (!exam) {
      throw new NotFoundError(`Exam not found: ${examId}`);
    }

    const isStaff = await isCourseStaffTx(tx, actor.userId, exam.courseId);
    if (!isStaff) {
      throw new ForbiddenError("Only course staff can release exam sessions.");
    }

    const active = await examSessionRepo.withTx(tx).findAllActiveForExam(examId);
    const now = new Date();
    for (const session of active) {
      await examSessionRepo.withTx(tx).update(session.id, {
        endedAt: now,
        releaseReason: "released_by_instructor",
      });
      await examSessionRepo.withTx(tx).recordEvent({
        sessionId: session.id,
        eventType: "release",
        metadata: { reason: "released_by_instructor", endedByUserId: actor.userId },
      });
    }

    return { released: active.length, releasedUserIds: active.map((s) => s.userId) };
  });
}
