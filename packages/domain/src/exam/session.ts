import {
  courseMembershipRepo,
  examRepo,
  examSessionRepo,
  runTransaction,
  type Prisma
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from "../shared/errors";

export type ExamSessionReleaseReason = "submitted" | "time_up" | "released_by_instructor";

export type ExamSessionEventType =
  | "enter"
  | "leave"
  | "visibility_lost"
  | "release"
  | "auto_close"
  | "heartbeat";

export interface ActiveSessionContext {
  session: {
    id: string;
    examId: string;
    userId: string;
    startedAt: Date;
    ipPin: string | null;
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
  examId: string
) {
  const exam = await examRepo.withTx(tx).findById(examId);
  if (!exam) {
    throw new NotFoundError(`Exam not found: ${examId}`);
  }

  const membership = await courseMembershipRepo
    .withTx(tx)
    .findByComposite(exam.courseId, userId);

  if (membership?.status !== "active") {
    throw new ForbiddenError("You must be enrolled in the course to access this exam.");
  }

  return exam;
}

// Idempotent: if the actor already has an unended session for this exam, returns it without a new enter event.
export async function startSession(
  actor: ActorContext,
  { examId, ipPin }: { examId: string; ipPin?: string | null }
) {
  return runTransaction(async (tx) => {
    await assertEnrolledInExamCourse(tx, actor.userId, examId);

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
          ipPin: ipPin ?? null,
          lastHeartbeatAt: now
        })
      : await examSessionRepo.withTx(tx).create({
          userId: actor.userId,
          examId,
          startedAt: now,
          ipPin: ipPin ?? null,
          lastHeartbeatAt: now
        });

    await examSessionRepo.withTx(tx).recordEvent({ sessionId: session.id, eventType: "enter" });

    return session;
  });
}

export async function endSession(
  actor: ActorContext,
  { examId, reason }: { examId: string; reason: ExamSessionReleaseReason }
) {
  return runTransaction(async (tx) => {
    await assertEnrolledInExamCourse(tx, actor.userId, examId);

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);

    if (!session) {
      throw new NotFoundError("No active exam session to end.");
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      endedAt: new Date(),
      releaseReason: reason
    });

    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "release",
      metadata: { reason }
    });

    return updated;
  });
}

// Does NOT touch the session row itself — use `heartbeat` to update `lastHeartbeatAt`.
export async function recordEvent(
  actor: ActorContext,
  {
    examId,
    eventType,
    metadata
  }: {
    examId: string;
    eventType: ExamSessionEventType;
    metadata?: Prisma.InputJsonValue | null;
  }
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
      ...(metadata === undefined || metadata === null ? {} : { metadata })
    });
  });
}

export async function heartbeat(userId: string, examId: string) {
  return runTransaction(async (tx) => {
    const session = await examSessionRepo.withTx(tx).findByUserAndExam(userId, examId);
    if (session?.endedAt !== null) {
      throw new NotFoundError("No active exam session to heartbeat.");
    }

    await examSessionRepo.withTx(tx).update(session.id, {
      lastHeartbeatAt: new Date()
    });
    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "heartbeat"
    });

    return session;
  });
}

// Idempotent: re-running on an exam with no active sessions is a no-op.
export async function autoCloseForExam(examId: string): Promise<{ closed: number }> {
  const active = await examSessionRepo.findAllActiveForExam(examId);
  for (const session of active) {
    await examSessionRepo.endSession({ sessionId: session.id, reason: "time_up" });
    await examSessionRepo.recordEvent({ sessionId: session.id, eventType: "auto_close" });
  }
  return { closed: active.length };
}

export async function getActiveSessionContext(
  userId: string
): Promise<ActiveSessionContext | null> {
  const session = await examSessionRepo.findActiveForUser(userId);
  if (!session) return null;

  const exam = await examRepo.findByIdOrThrow(session.examId, {
    id: true,
    courseId: true,
    title: true
  });

  return {
    session: {
      id: session.id,
      examId: session.examId,
      userId: session.userId,
      startedAt: session.startedAt,
      ipPin: session.ipPin
    },
    exam: {
      id: exam.id,
      courseId: exam.courseId,
      title: exam.title
    },
    course: {
      id: exam.courseId
    }
  };
}

// Defense-in-depth: loaders don't trust that `hooks.server.ts` already redirected users without an active session.
export async function requireActiveSessionForUserExam(userId: string, examId: string) {
  const session = await examSessionRepo.findActiveForUser(userId);
  if (session?.examId !== examId || session.endedAt !== null) {
    throw new ForbiddenError("No active exam session for this exam.");
  }
  return session;
}

/** 5-minute grace window before `exam.startsAt` when start is allowed. */
export const START_GRACE_MS = 5 * 60 * 1000;

/** Default heartbeat audit-event throttle: one event per minute per session. */
export const HEARTBEAT_EVENT_THROTTLE_MS = 60 * 1000;

// Sessions are mutually exclusive globally — a different active exam blocks start (hook would otherwise redirect-loop).
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
  /** True when this call freshly created (or re-opened) the session. */
  created: boolean;
}

export async function startSessionWithGate(
  actor: ActorContext,
  options: {
    examId: string;
    ipPin?: string | null;
    now?: Date;
    gracePeriodMs?: number;
  }
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
  const session = await startSession(actor, {
    examId: options.examId,
    ipPin: options.ipPin ?? null
  });

  return {
    session: {
      id: session.id,
      examId: session.examId,
      userId: session.userId,
      startedAt: session.startedAt,
      endedAt: session.endedAt
    },
    exam: { id: exam.id, endsAt: exam.endsAt },
    created: !sameExamIdempotent
  };
}

export async function releaseSessionAsInstructor(
  actor: ActorContext,
  { examId, targetUserId }: { examId: string; targetUserId: string }
) {
  return runTransaction(async (tx) => {
    const exam = await examRepo.withTx(tx).findById(examId);
    if (!exam) {
      throw new NotFoundError(`Exam not found: ${examId}`);
    }

    const callerMembership = await courseMembershipRepo
      .withTx(tx)
      .findByComposite(exam.courseId, actor.userId);
    const isStaff =
      callerMembership?.status === "active" &&
      (callerMembership.role === "teacher" || callerMembership.role === "ta");
    if (!isStaff) {
      throw new ForbiddenError("Only course staff can release exam sessions.");
    }

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(targetUserId, examId);
    if (session?.endedAt !== null) {
      throw new NotFoundError("No active exam session to release.");
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      endedAt: new Date(),
      releaseReason: "released_by_instructor"
    });

    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "release",
      metadata: {
        reason: "released_by_instructor",
        endedByUserId: actor.userId
      }
    });

    return updated;
  });
}

// Always bumps `lastHeartbeatAt`; throttles the audit-event insert to avoid flooding `ExamSessionEvent`.
export async function heartbeatWithThrottle(
  userId: string,
  examId: string,
  options: { throttleMs?: number; now?: Date } = {}
): Promise<{ session: { id: string; lastHeartbeatAt: Date }; recordedEvent: boolean }> {
  const throttleMs = options.throttleMs ?? HEARTBEAT_EVENT_THROTTLE_MS;
  const now = options.now ?? new Date();

  return runTransaction(async (tx) => {
    const session = await examSessionRepo.withTx(tx).findByUserAndExam(userId, examId);
    if (session?.endedAt !== null) {
      throw new NotFoundError("No active exam session to heartbeat.");
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      lastHeartbeatAt: now
    });

    const lastEvent = await examSessionRepo
      .withTx(tx)
      .findLatestEventOfType(session.id, "heartbeat");

    const shouldRecord =
      !lastEvent || now.getTime() - lastEvent.occurredAt.getTime() >= throttleMs;

    if (shouldRecord) {
      await examSessionRepo.withTx(tx).recordEvent({
        sessionId: session.id,
        eventType: "heartbeat"
      });
    }

    return {
      session: { id: updated.id, lastHeartbeatAt: updated.lastHeartbeatAt },
      recordedEvent: shouldRecord
    };
  });
}
