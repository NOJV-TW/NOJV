import {
  courseMembershipRepo,
  examRepo,
  examSessionRepo,
  runTransaction,
  type Prisma
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from "../shared/errors";

/**
 * Exam session lifecycle helpers.
 *
 * The Phase 4 hook uses `getActiveSessionContext` to detect "is this
 * student currently in an exam?" and reroute them back to the exam
 * landing page on every navigation. `startSession` and `endSession`
 * are the two mutation points; `recordEvent` and `heartbeat` are
 * lightweight append-only helpers.
 *
 * Access checks (actor must be enrolled in the exam's course and the
 * exam must be published + active) live here so every entry point
 * goes through the same gate.
 */

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

/**
 * Assert that `userId` is an active member of the course the exam
 * belongs to. Used by every mutation in this module.
 */
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

/**
 * Begin (or re-enter) an exam session for `actor`. Idempotent: if the
 * actor already has an unended session for this exam, returns it
 * without creating a new enter event.
 */
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

/**
 * End the actor's session for `examId`. Writes `endedAt` +
 * `releaseReason` and appends a `release` event. Throws
 * `NotFoundError` if no session exists.
 */
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

/**
 * Append an audit-log event to the actor's current session for
 * `examId`. Does NOT touch the session row itself — callers wanting
 * to update `lastHeartbeatAt` should use `heartbeat` instead.
 */
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

/**
 * Update `lastHeartbeatAt` and append a `heartbeat` event.
 * Deliberately lighter-weight than `recordEvent` — the Phase 4
 * client pings this on a short interval, so the two writes are
 * batched into a single transaction.
 */
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

/**
 * Auto-close every active session for `examId`. Called by the
 * Temporal `examAutoCloseWorkflow` when `exam.endsAt` passes.
 *
 * Each closed session gets `releaseReason = "time_up"` and an
 * `auto_close` audit event. Returns the number of sessions closed
 * so the activity can log it.
 *
 * Idempotent: re-running on an exam with no remaining active
 * sessions is a no-op (`{ closed: 0 }`).
 */
export async function autoCloseForExam(examId: string): Promise<{ closed: number }> {
  const active = await examSessionRepo.findAllActiveForExam(examId);
  for (const session of active) {
    await examSessionRepo.endSession({ sessionId: session.id, reason: "time_up" });
    await examSessionRepo.recordEvent({ sessionId: session.id, eventType: "auto_close" });
  }
  return { closed: active.length };
}

/**
 * Used by the Phase 4 `hooks.server.ts` lock. Returns the active
 * session + its exam + the exam's course, or `null` if the user is
 * not currently in an exam.
 */
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

/**
 * Assert that `userId` has an active (non-ended) session for the
 * given `examId`. Used by the Phase 3 problem/workspace loaders as
 * defense in depth — Phase 4.1's `hooks.server.ts` gate should have
 * already redirected any user without an active session to the exam
 * landing, but loaders don't trust that.
 *
 * Throws `ForbiddenError` if the user has no active session for this
 * exam (including the case where a session exists but has already
 * ended). Returns the active session row on success.
 */
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

/**
 * Endpoint-facing wrapper around `startSession` used by
 * `POST /api/exam-session/start`. Adds three gates that the bare
 * `startSession` does not enforce:
 *
 *   1. Exam status must be `published` (404 otherwise).
 *   2. `now` must be within `[startsAt - grace, endsAt)` (410 otherwise).
 *   3. The user must not already have an active session on a DIFFERENT
 *      exam (409 otherwise) — sessions are mutually exclusive globally
 *      because Phase 4.1's hook would otherwise redirect-loop the user.
 *
 * Idempotent for the (user, exam) pair: a second call returns the
 * existing session without recording a new `enter` event. The
 * `created` flag tells the caller whether to reply 201 or 200.
 */
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

  // Step 1: load the exam outside the transaction so we can fail fast
  // before consuming a connection. The exam is read again inside the
  // transaction below by `assertEnrolledInExamCourse` for consistency.
  const exam = await examRepo.findById(options.examId);
  if (exam?.status !== "published") {
    throw new NotFoundError(`Exam not found: ${options.examId}`);
  }

  if (now.getTime() < exam.startsAt.getTime() - grace) {
    // Status 410 Gone is the closest fit for "exam time window is closed".
    // (404 would be misleading — the exam exists, just not open yet.)
    throw new HttpError("Exam has not started yet.", 410);
  }
  if (now.getTime() >= exam.endsAt.getTime()) {
    throw new HttpError("Exam has ended.", 410);
  }

  // Step 2: cross-exam mutual exclusion. If the user has an unended
  // session on a *different* exam, refuse to start this one. The
  // single-exam idempotent case is handled inside `startSession` —
  // here we only block conflicting concurrent exams.
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

/**
 * Instructor-initiated session release. Closes the session belonging
 * to `targetUserId` for the given `examId`, regardless of who the
 * caller is — but the caller must be a teacher or TA of the exam's
 * course. Records a `release` event with metadata
 * `{ reason: "released_by_instructor", endedByUserId }`.
 *
 * Used by `POST /api/exam-session/end` when `reason` is
 * `released_by_instructor`. Throws:
 *   - `NotFoundError` if no active session exists for the target.
 *   - `ForbiddenError` if the caller is not staff of the exam's course.
 */
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

/**
 * Endpoint-facing wrapper around `heartbeat` that throttles the audit
 * event write while still bumping `lastHeartbeatAt` on every call.
 *
 * The Phase 4 client pings on a 15-30s interval, so writing a row
 * per ping would flood `ExamSessionEvent`. This helper:
 *   - Always updates `ActiveExamSession.lastHeartbeatAt`.
 *   - Only inserts a `heartbeat` event if the most recent heartbeat
 *     event for this session is older than `throttleMs` (default 60s).
 *
 * Returns `{ session, recordedEvent }` so the caller can include the
 * fresh heartbeat timestamp in its response.
 */
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
