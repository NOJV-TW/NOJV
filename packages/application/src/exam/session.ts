import {
  courseMembershipRepo,
  courseRepo,
  examRepo,
  examSessionRepo,
  participationRepo,
  runTransaction,
  submissionRepo,
  type Prisma,
} from "@nojv/db";
import type { ExamAutoCloseInput } from "@nojv/core";

import type { ActorContext } from "../shared/actor-context";
import { ConflictError, ForbiddenError, HttpError, NotFoundError } from "../shared/errors";
import { isCourseStaffTx } from "../shared/permissions";
import { checkProctoringGateInTx, type ProctoringDenialReason } from "../proctoring/gate";

export type ExamSessionReleaseReason = "submitted" | "time_up" | "released_by_instructor";

export type ExamSessionEventType =
  "enter" | "leave" | "visibility_lost" | "release" | "auto_close" | "heartbeat" | "ip_reset";

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
    pageLockEnabled: boolean;
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

type ActiveExamSessionRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof examSessionRepo.withTx>["findByUserAndExam"]>>
>;

interface EntryGate {
  ip: string | null;
  now: Date;
  startGraceMs: number;
}

type OpenSessionResult =
  { ok: true; session: ActiveExamSessionRow } | { ok: false; reason: ProctoringDenialReason };

function lockUserExamSessions(tx: Prisma.TransactionClient, userId: string) {
  const lockKey = `exam-session:${userId}`;
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

async function openSessionInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  examId: string,
  gate: EntryGate | null,
): Promise<OpenSessionResult> {
  await lockUserExamSessions(tx, actor.userId);

  const exam = await assertEnrolledInExamCourse(tx, actor.userId, examId);

  const activeElsewhere = await examSessionRepo.withTx(tx).findActiveForUser(actor.userId);
  if (activeElsewhere && activeElsewhere.examId !== examId) {
    throw new ConflictError("You already have an active session on a different exam.");
  }

  const existingParticipation = await participationRepo
    .withTx(tx)
    .findExamParticipation(examId, actor.userId);
  const existing = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);
  if (
    existing?.releaseReason === "submitted" ||
    existingParticipation?.status === "submitted"
  ) {
    throw new ForbiddenError("You have already submitted this exam.");
  }

  if (gate) {
    const verdict = await checkProctoringGateInTx(tx, {
      entityKind: "exam",
      entityId: examId,
      userId: actor.userId,
      ip: gate.ip,
      now: gate.now,
      startGraceMs: gate.startGraceMs,
    });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
  }

  const activateOnEntry =
    !existingParticipation || existingParticipation.status === "registered";
  const participation = await participationRepo
    .withTx(tx)
    .upsertExamActive(examId, actor.userId, activateOnEntry, new Date());

  if (gate?.ip && exam.ipBindingEnabled && !existingParticipation) {
    const bound = await participationRepo
      .withTx(tx)
      .bindExamIpPinIfUnset(participation.id, gate.ip);
    if (!bound) {
      throw new ConflictError("Exam entry conflicted with another request. Please try again.");
    }
  }

  if (existing?.endedAt === null) {
    return { ok: true, session: existing };
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

  return { ok: true, session };
}

function entryDenialError(examId: string, reason: ProctoringDenialReason): HttpError {
  switch (reason) {
    case "not_found":
    case "not_published":
      return new NotFoundError(`Exam not found: ${examId}`);
    case "not_enrolled":
      return new ForbiddenError("You must be enrolled in the course to access this exam.");
    case "course_archived":
      return new ForbiddenError("This course is archived; new exam sessions are not allowed.");
    case "not_started":
      return new HttpError("Exam has not started yet.", 410);
    case "ended":
      return new HttpError("Exam has ended.", 410);
    case "ip_whitelist":
    case "ip_binding":
      return new ForbiddenError(
        "Exam entry blocked: your network does not match the exam's IP restrictions.",
      );
  }
}

export async function startSession(actor: ActorContext, { examId }: { examId: string }) {
  const result = await runTransaction((tx) => openSessionInTx(tx, actor, examId, null));
  if (!result.ok) throw entryDenialError(examId, result.reason);
  return result.session;
}

export async function endSession(
  actor: ActorContext,
  { examId, reason }: { examId: string; reason: ExamSessionReleaseReason },
) {
  return runTransaction(async (tx) => {
    await lockUserExamSessions(tx, actor.userId);

    await assertEnrolledInExamCourse(tx, actor.userId, examId);

    const session = await examSessionRepo.withTx(tx).findByUserAndExam(actor.userId, examId);

    if (!session || (session.endedAt !== null && session.releaseReason === null)) {
      throw new NotFoundError("No active exam session to end.");
    }

    if (session.releaseReason === "submitted") return session;

    const now = new Date();
    if (reason === "submitted") {
      await participationRepo.withTx(tx).markExamSubmitted(examId, actor.userId, now);
    }

    const updated = await examSessionRepo.withTx(tx).update(session.id, {
      endedAt: now,
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

export async function autoCloseForExam(
  input: ExamAutoCloseInput,
  now = new Date(),
): Promise<{ closed: number }> {
  return runTransaction(async (tx) => {
    await examRepo.withTx(tx).lockForUpdate(input.examId);
    const exam = await examRepo.withTx(tx).findById(input.examId);
    if (
      exam?.status !== "published" ||
      exam.scheduleRevision !== input.scheduleRevision ||
      exam.timerFingerprint !== input.timerFingerprint ||
      exam.endsAt.getTime() > now.getTime()
    ) {
      return { closed: 0 };
    }

    const closed = await examSessionRepo.withTx(tx).closeActiveForExam(input.examId, now);
    if (closed.length > 0) {
      await examSessionRepo
        .withTx(tx)
        .recordEvents(
          closed.map(({ id: sessionId }) => ({ sessionId, eventType: "auto_close" })),
        );
    }
    return { closed: closed.length };
  });
}

// intentional-nullable: No active exam session is an ordinary state for callers.
export async function getActiveSessionContext(
  userId: string,
): Promise<ActiveSessionContext | null> {
  const session = await examSessionRepo.findActiveForUser(userId);
  if (!session) return null;

  return {
    session: {
      id: session.id,
      examId: session.examId,
      userId: session.userId,
      startedAt: session.startedAt,
    },
    exam: {
      id: session.examId,
      courseId: session.exam.courseId,
      pageLockEnabled: session.exam.pageLockEnabled,
      title: session.exam.title,
    },
    course: {
      id: session.exam.courseId,
    },
  };
}

export async function getSessionState(userId: string, examId: string) {
  return runTransaction(async (tx) => {
    const [session, participation] = await Promise.all([
      examSessionRepo.withTx(tx).findByUserAndExam(userId, examId),
      participationRepo.withTx(tx).findExamParticipation(examId, userId),
    ]);
    const hasSubmitted =
      session?.releaseReason === "submitted" || participation?.status === "submitted";
    return { hasActiveSession: !hasSubmitted && session?.endedAt === null, hasSubmitted };
  });
}

export async function listSubmittedProblemIds(userId: string, examId: string) {
  const grouped = await submissionRepo.groupByUserAndProblem({
    examId,
    userId,
    sampleOnly: false,
  });
  return grouped.map((group) => group.problemId);
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
    ip?: string | null;
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
  const result = await runTransaction((tx) =>
    openSessionInTx(tx, actor, options.examId, {
      ip: options.ip ?? null,
      now,
      startGraceMs: grace,
    }),
  );
  if (!result.ok) throw entryDenialError(options.examId, result.reason);
  const { session } = result;

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

    await lockUserExamSessions(tx, targetUserId);

    const participation = await participationRepo
      .withTx(tx)
      .findExamIpPin(examId, targetUserId);

    const exemptUntil = new Date(now.getTime() + IP_BINDING_RESET_GRACE_MINUTES * 60_000);
    await participationRepo.withTx(tx).clearExamPinAndExempt(examId, targetUserId, exemptUntil);

    const session =
      (await examSessionRepo.withTx(tx).findByUserAndExam(targetUserId, examId)) ??
      (await examSessionRepo.withTx(tx).create({
        userId: targetUserId,
        examId,
        startedAt: now,
        endedAt: now,
        lastHeartbeatAt: now,
      }));
    await examSessionRepo.withTx(tx).recordEvent({
      sessionId: session.id,
      eventType: "ip_reset",
      metadata: {
        resetByUserId: actor.userId,
        clearedIpPin: participation?.ipPin ?? null,
        exemptUntil: exemptUntil.toISOString(),
      },
    });

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
