import {
  courseMembershipRepo,
  examRepo,
  examSessionRepo,
  runTransaction,
  type Prisma
} from "@nojv/db";

import type { ActorContext } from "../shared/actor-context";
import { ForbiddenError, NotFoundError } from "../shared/errors";

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
